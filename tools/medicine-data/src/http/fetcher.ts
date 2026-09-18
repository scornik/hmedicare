import { SOURCES, requireContactEmail, userAgent } from '../config.js';
import type { StateStore } from '../state/db.js';
import { detectChallenge } from './challenge.js';
import { RawStore, sha256 } from './raw-store.js';
import { parseRobots, type RobotsPolicy } from './robots.js';

export class SourceBlockedError extends Error {
  constructor(readonly source: string, reason: string) { super(`Source ${source} is BLOCKED: ${reason}`); }
}
export class CapReachedError extends Error {
  constructor(readonly host: string, cap: number) { super(`Daily request cap (${cap}) reached for ${host}; resume tomorrow (UTC).`); }
}
export class RobotsUnavailableError extends Error {}

export type FetchOutcome =
  | { kind: 'ok'; url: string; status: number; headers: Record<string, string>; body: Buffer; contentHash: string; fetchedAt: string; rawPath?: string }
  | { kind: 'not_modified'; url: string; status: 304; fetchedAt: string; headers: Record<string, string> }
  | { kind: 'robots_disallowed'; url: string }
  | { kind: 'http_error'; url: string; status: number; error: string };

export interface FetcherOptions {
  store: StateStore;
  env?: NodeJS.ProcessEnv;
  delays: { minMs: number; maxMs: number };
  /** Daily cap for a source; the host cap is the minimum over sources sharing the host. */
  capFor: (sourceId: string) => number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
  rawStore?: RawStore;
  /** Maps a host to all source ids that share it (a block on the host stops all of them). */
  sourcesForHost?: (host: string) => string[];
  maxRetries?: number;
}

const BLOCK_STATUSES = new Set([401, 403, 429]);
const MAX_REDIRECTS = 5;

export class PoliteFetcher {
  readonly userAgent: string;
  private readonly robots = new Map<string, RobotsPolicy>();
  private readonly hostLocks = new Map<string, Promise<unknown>>();
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;
  readonly rawStore: RawStore;

  constructor(private readonly options: FetcherOptions) {
    // Hard gate: no network access without a real contact address.
    this.userAgent = userAgent(requireContactEmail(options.env ?? process.env));
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.rawStore = options.rawStore ?? new RawStore();
  }

  private sourcesForHost(host: string): string[] {
    if (this.options.sourcesForHost) return this.options.sourcesForHost(host);
    return SOURCES.filter(source => new URL(source.origin).host === host).map(source => source.id);
  }

  private assertNotBlocked(sourceId: string): void {
    const status = this.options.store.sourceStatus(sourceId);
    if (status?.status === 'BLOCKED') throw new SourceBlockedError(sourceId, status.reason ?? 'previously blocked');
  }

  private block(sourceId: string, host: string, reason: string): never {
    const affected = new Set([sourceId, ...this.sourcesForHost(host)]);
    for (const id of affected) {
      this.options.store.setSourceStatus(id, 'BLOCKED', reason);
      this.options.store.logEvent(id, 'BLOCKED', reason);
    }
    throw new SourceBlockedError(sourceId, reason);
  }

  /** Serializes all requests to one host (concurrency 1 per host, shared across sources). */
  private withHostLock<T>(host: string, task: () => Promise<T>): Promise<T> {
    const previous = this.hostLocks.get(host) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    this.hostLocks.set(host, run);
    return run;
  }

  private async politeWait(host: string): Promise<void> {
    // Persisted in the state store so delays hold across fetcher instances and process restarts.
    const last = this.options.store.lastRequestAt(host);
    if (last === undefined) return;
    const { minMs, maxMs } = this.options.delays;
    const jitter = minMs + Math.floor(this.random() * (maxMs - minMs + 1));
    const crawlDelayMs = (this.robots.get(host)?.crawlDelaySeconds ?? 0) * 1000;
    const wait = last + Math.max(jitter, crawlDelayMs) - this.now();
    if (wait > 0) await this.sleep(wait);
  }

  private hostCap(sourceId: string, host: string): number {
    const ids = new Set([sourceId, ...this.sourcesForHost(host)]);
    return Math.min(...[...ids].map(id => this.options.capFor(id)));
  }

  /** One raw HTTP request, with delay, cap accounting and block detection. Caller must hold the host lock. */
  private async request(sourceId: string, url: string, headers: Record<string, string>, countTowardsCap = true): Promise<Response> {
    const host = new URL(url).host;
    this.assertNotBlocked(sourceId);
    if (countTowardsCap) {
      const cap = this.hostCap(sourceId, host);
      if (this.options.store.requestsToday(host) >= cap) throw new CapReachedError(host, cap);
    }
    await this.politeWait(host);
    this.options.store.setLastRequestAt(host, this.now());
    this.options.store.incrementRequests(host);
    return this.fetchImpl(url, {
      headers: { 'User-Agent': this.userAgent, 'Accept-Language': 'en,bn;q=0.8', ...headers },
      redirect: 'manual'
    });
  }

  /**
   * @param opts.objectStorage  Only for an adapter-listed object-storage host serving a licensed file after a redirect.
   *   Buckets answer a missing /robots.txt with 401/403 (AccessDenied) for every client, so per RFC 9309 §2.3.1.3
   *   (4xx = robots.txt unavailable = no rules) it is treated as absent. 429 and any 401/403 on the file itself still block.
   */
  async robotsFor(sourceId: string, origin: string, opts: { objectStorage?: boolean } = {}): Promise<RobotsPolicy> {
    const host = new URL(origin).host;
    const cached = this.robots.get(host);
    if (cached) return cached;
    return this.withHostLock(host, async () => {
      const again = this.robots.get(host);
      if (again) return again;
      let robotsUrl = new URL('/robots.txt', origin).toString();
      let response: Response;
      let text = '';
      // RFC 9309: follow up to five redirects for robots.txt (e.g. http→https, www→apex on the same site).
      for (let hop = 0; ; hop++) {
        try {
          response = await this.request(sourceId, robotsUrl, { Accept: 'text/plain' }, false);
        } catch (error) {
          if (error instanceof SourceBlockedError) throw error;
          throw new RobotsUnavailableError(`robots.txt unreachable for ${host}: ${networkMessage(error)}`);
        }
        text = await response.text();
        if (opts.objectStorage && (response.status === 401 || response.status === 403 || response.status === 404)) {
          this.options.store.logEvent(sourceId, 'ROBOTS_ABSENT_OBJECT_STORAGE', `HTTP ${response.status} on ${robotsUrl}; treated as no robots.txt (RFC 9309 4xx)`);
          const policy = parseRobots(new URL(robotsUrl).origin, '', { status: 404, fetchedAt: new Date(this.now()).toISOString(), contentHash: null });
          this.robots.set(host, policy);
          return policy;
        }
        if (BLOCK_STATUSES.has(response.status)) this.block(sourceId, host, `HTTP ${response.status} on ${robotsUrl}`);
        const challenge = detectChallenge(response.status, response.headers, text);
        if (challenge) this.block(sourceId, host, `${challenge} on ${robotsUrl}`);
        if (response.status < 300 || response.status >= 400) break;
        const next = new URL(response.headers.get('location') ?? '', robotsUrl);
        const siteOf = (h: string) => h.replace(/^www\./, '');
        if (hop >= MAX_REDIRECTS || siteOf(next.host) !== siteOf(host)) {
          throw new RobotsUnavailableError(`robots.txt for ${host} redirects to ${next}; resolve origin in config before crawling`);
        }
        robotsUrl = next.toString();
      }
      const fetchedAt = new Date(this.now()).toISOString();
      if (response.status >= 500) {
        // RFC 9309: an unreachable robots.txt means assume full disallow.
        throw new RobotsUnavailableError(`robots.txt returned HTTP ${response.status} for ${host}; treating as disallow-all`);
      }
      const policy = parseRobots(origin, response.status === 200 ? text : '', {
        status: response.status, fetchedAt, contentHash: response.status === 200 ? sha256(text) : null
      });
      this.robots.set(host, policy);
      return policy;
    });
  }

  /**
   * Fetches a URL for a source: robots check, per-host serialization, randomized delay (>= Crawl-delay),
   * daily cap, conditional headers, manual same-host redirects, stop on 401/403/429/challenge,
   * limited backoff on 5xx/network errors, and a compressed raw snapshot.
   */
  async fetch(sourceId: string, url: string, opts: { etag?: string | null; lastModified?: string | null; accept?: string; snapshot?: boolean; countTowardsCap?: boolean; redirectHosts?: string[] } = {}): Promise<FetchOutcome> {
    const origin = new URL(url).origin;
    const host = new URL(url).host;
    this.assertNotBlocked(sourceId);
    const robots = await this.robotsFor(sourceId, origin);
    if (!robots.isAllowed(url)) {
      this.options.store.logEvent(sourceId, 'ROBOTS_DISALLOWED', url);
      return { kind: 'robots_disallowed', url };
    }
    return this.withHostLock(host, async () => {
      let current = url;
      const maxRetries = this.options.maxRetries ?? 2;
      for (let hop = 0, attempt = 0; hop <= MAX_REDIRECTS;) {
        const headers: Record<string, string> = { Accept: opts.accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5' };
        if (current === url && opts.etag) headers['If-None-Match'] = opts.etag;
        if (current === url && opts.lastModified) headers['If-Modified-Since'] = opts.lastModified;
        let response: Response;
        try {
          response = await this.request(sourceId, current, headers, opts.countTowardsCap ?? true);
        } catch (error) {
          if (error instanceof SourceBlockedError || error instanceof CapReachedError) throw error;
          if (attempt++ < maxRetries) { await this.sleep(10_000 * 3 ** attempt); continue; }
          return { kind: 'http_error', url: current, status: 0, error: networkMessage(error) };
        }
        const fetchedAt = new Date(this.now()).toISOString();
        const headerRecord = Object.fromEntries(response.headers.entries());
        if (BLOCK_STATUSES.has(response.status)) {
          await response.body?.cancel();
          this.block(sourceId, host, `HTTP ${response.status} on ${current}`);
        }
        if (response.status === 304) return { kind: 'not_modified', url: current, status: 304, fetchedAt, headers: headerRecord };
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          const location = response.headers.get('location');
          if (!location) return { kind: 'http_error', url: current, status: response.status, error: 'redirect without location' };
          const next = new URL(location, current);
          const offHost = next.host !== new URL(current).host && next.host !== host;
          if (offHost && !opts.redirectHosts?.some(allowed => next.host === allowed || next.host.endsWith(`.${allowed}`))) {
            return { kind: 'http_error', url: current, status: response.status, error: `off-host redirect to ${next.host} not followed` };
          }
          const nextRobots = next.host === host ? robots : await this.robotsFor(sourceId, next.origin, { objectStorage: offHost });
          if (!nextRobots.isAllowed(next.toString())) {
            this.options.store.logEvent(sourceId, 'ROBOTS_DISALLOWED', `${next} (redirect from ${current})`);
            return { kind: 'robots_disallowed', url: next.toString() };
          }
          current = next.toString();
          hop++;
          continue;
        }
        const body = Buffer.from(await response.arrayBuffer());
        const challenge = detectChallenge(response.status, response.headers, body.toString('utf8', 0, Math.min(body.length, 50_000)));
        if (challenge) this.block(sourceId, host, `${challenge} on ${current}`);
        if (response.status >= 500) {
          if (attempt++ < maxRetries) { await this.sleep(10_000 * 3 ** attempt); continue; }
          this.options.store.logEvent(sourceId, 'HTTP_ERROR', `HTTP ${response.status} on ${current}`);
          return { kind: 'http_error', url: current, status: response.status, error: `HTTP ${response.status}` };
        }
        if (response.status !== 200) return { kind: 'http_error', url: current, status: response.status, error: `HTTP ${response.status}` };
        const contentHash = sha256(body);
        const rawPath = opts.snapshot === false ? undefined
          : this.rawStore.write(sourceId, url, body, { finalUrl: current, fetchedAt, status: response.status, contentHash, contentType: headerRecord['content-type'] });
        return { kind: 'ok', url: current, status: response.status, headers: headerRecord, body, contentHash, fetchedAt, rawPath };
      }
      return { kind: 'http_error', url: current, status: 310, error: 'too many redirects' };
    });
  }
}

/** Node's fetch wraps TLS/DNS failures as "fetch failed"; surface the underlying cause. */
function networkMessage(error: unknown): string {
  const e = error as Error & { cause?: { message?: string; code?: string } };
  return e.cause?.message ? `${e.message}: ${e.cause.code ?? ''} ${e.cause.message}`.trim() : e.message;
}
