import { effectiveCap, effectiveDelays, getSource, loadOverrides, SOURCES, type SourceId, type Verdict } from '../config.js';
import { loadVerdicts, type SourceVerdict } from '../compliance/gate.js';
import { CapReachedError, PoliteFetcher, RobotsUnavailableError, SourceBlockedError } from '../http/fetcher.js';
import { RawStore, sha256 } from '../http/raw-store.js';
import { RawFactSchema } from '../schemas.js';
import { ADAPTERS } from '../sources/index.js';
import type { SourceAdapter } from '../sources/types.js';
import type { StateStore, UrlKind } from '../state/db.js';

export const CRAWLABLE_VERDICTS: Verdict[] = ['ALLOWED', 'RESTRICTED', 'UNCLEAR'];

export function makeFetcher(store: StateStore, verdicts: Record<string, SourceVerdict>): PoliteFetcher {
  const overrides = loadOverrides();
  return new PoliteFetcher({
    store,
    delays: effectiveDelays(overrides),
    capFor: id => {
      const v = verdicts[id]?.verdict;
      // Sources without a verdict yet (compliance run itself) get the most conservative cap.
      return v ? effectiveCap(id as SourceId, v, overrides) : 1500;
    }
  });
}

/** Sources that may be crawled now, with the reason others are skipped. */
export function crawlableSources(store: StateStore, requested?: string[]): { run: Array<{ id: string; adapter: SourceAdapter }>; skipped: Array<{ id: string; reason: string }> } {
  const verdicts = loadVerdicts();
  const run: Array<{ id: string; adapter: SourceAdapter }> = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  for (const source of SOURCES) {
    if (requested && !requested.includes(source.id)) continue;
    const verdict = verdicts[source.id]?.verdict;
    const status = store.sourceStatus(source.id);
    if (!verdict) skipped.push({ id: source.id, reason: 'no compliance verdict' });
    else if (!CRAWLABLE_VERDICTS.includes(verdict)) skipped.push({ id: source.id, reason: `verdict ${verdict}` });
    else if (!source.crawlable) skipped.push({ id: source.id, reason: 'source is not crawlable by policy' });
    else if (status?.status === 'BLOCKED') skipped.push({ id: source.id, reason: `BLOCKED: ${status.reason}` });
    else if (!ADAPTERS[source.id]) skipped.push({ id: source.id, reason: 'no adapter' });
    else run.push({ id: source.id, adapter: ADAPTERS[source.id] });
  }
  return { run, skipped };
}

interface FetchLoopOptions { kinds: UrlKind[]; limit: number; refresh?: boolean }

/** Fetches pending frontier URLs of the given kinds for one source. Stops the source on block or cap. */
async function fetchLoop(store: StateStore, fetcher: PoliteFetcher, id: string, adapter: SourceAdapter, opts: FetchLoopOptions): Promise<{ fetched: number; stopped?: string }> {
  let fetched = 0;
  while (fetched < opts.limit) {
    const batch = store.nextPending(id, opts.kinds, Math.min(50, opts.limit - fetched));
    if (!batch.length) break;
    for (const row of batch) {
      if (fetched >= opts.limit) break;
      try {
        const outcome = await fetcher.fetch(id, row.url, {
          etag: row.raw_path ? row.etag : null,
          lastModified: row.raw_path ? row.last_modified : null,
          accept: row.kind === 'detail' || row.kind === 'json' ? adapter.accept : undefined,
          redirectHosts: adapter.redirectHosts
        });
        fetched++;
        if (outcome.kind === 'robots_disallowed') { store.markFetched(id, row.url, { status: 'robots_disallowed', error: 'robots.txt disallows' }); continue; }
        if (outcome.kind === 'http_error') {
          store.markFetched(id, row.url, { status: 'failed', http_status: outcome.status, error: outcome.error });
          for (const link of adapter.fallbackSeeds?.(row.url) ?? []) {
            if (store.enqueue(id, link.url, link.kind)) store.logEvent(id, 'FALLBACK', `${row.url} failed (${outcome.error}); enqueued ${link.url}`);
          }
          continue;
        }
        if (outcome.kind === 'not_modified') {
          store.markFetched(id, row.url, { status: 'not_modified', fetched_at: outcome.fetchedAt, http_status: 304 });
          continue;
        }
        const expected = adapter.expectedSha256?.[row.url];
        if (expected && outcome.contentHash !== expected) {
          store.markFetched(id, row.url, { status: 'failed', http_status: outcome.status, content_hash: outcome.contentHash, error: `SHA-256 mismatch: expected ${expected}` });
          store.logEvent(id, 'CHECKSUM_MISMATCH', row.url);
          continue;
        }
        store.markFetched(id, row.url, {
          status: 'done', fetched_at: outcome.fetchedAt, http_status: outcome.status, content_hash: outcome.contentHash,
          raw_path: outcome.rawPath ?? null, etag: outcome.headers.etag ?? null, last_modified: outcome.headers['last-modified'] ?? null
        });
        if (adapter.extractLinks) {
          const links = adapter.extractLinks({ url: row.url, body: outcome.body, fetchedAt: outcome.fetchedAt, contentHash: outcome.contentHash, contentType: outcome.headers['content-type'] }, row.kind);
          let added = 0;
          for (const link of links) if (store.enqueue(id, link.url, link.kind)) added++;
          if (added) console.log(`[${id}] ${row.url} → ${added} new URLs`);
        }
      } catch (error) {
        if (error instanceof SourceBlockedError) { console.warn(`[${id}] STOPPED: ${error.message}`); return { fetched, stopped: error.message }; }
        if (error instanceof CapReachedError) { store.logEvent(id, 'CAP_REACHED', error.message); console.warn(`[${id}] ${error.message}`); return { fetched, stopped: error.message }; }
        if (error instanceof RobotsUnavailableError) { store.logEvent(id, 'ROBOTS_UNAVAILABLE', error.message); console.warn(`[${id}] ${error.message}`); return { fetched, stopped: error.message }; }
        throw error;
      }
    }
  }
  return { fetched };
}

/** discover: enqueue seeds (sitemaps first), then fetch sitemap/listing pages and extract detail URLs. */
export async function discover(store: StateStore, requested?: string[]): Promise<void> {
  const { run, skipped } = crawlableSources(store, requested);
  skipped.forEach(s => console.log(`[discover] skip ${s.id}: ${s.reason}`));
  const fetcher = makeFetcher(store, loadVerdicts());
  await Promise.all(run.map(async ({ id, adapter }) => {
    const source = getSource(id);
    let sitemaps: string[] = [];
    try {
      sitemaps = (await fetcher.robotsFor(id, source.origin)).sitemaps;
    } catch (error) {
      console.warn(`[${id}] ${(error as Error).message}`);
      return;
    }
    let added = 0;
    for (const link of [...adapter.seeds(sitemaps), ...source.seedUrls.map(url => ({ url, kind: 'listing' as const }))]) if (store.enqueue(id, link.url, link.kind)) added++;
    console.log(`[discover] ${id}: ${added} seed URLs enqueued`);
    const result = await fetchLoop(store, fetcher, id, adapter, { kinds: ['sitemap', 'listing'], limit: Number.POSITIVE_INFINITY });
    console.log(`[discover] ${id}: fetched ${result.fetched} sitemap/listing pages${result.stopped ? ` (stopped: ${result.stopped})` : ''}`);
  }));
}

/** crawl: fetch detail/export URLs. `sample` limits the first pass per source (default policy: 50). */
export async function crawl(store: StateStore, requested: string[] | undefined, opts: { sample?: number; refresh?: boolean }): Promise<void> {
  const { run, skipped } = crawlableSources(store, requested);
  skipped.forEach(s => console.log(`[crawl] skip ${s.id}: ${s.reason}`));
  const fetcher = makeFetcher(store, loadVerdicts());
  await Promise.all(run.map(async ({ id, adapter }) => {
    if (opts.refresh) console.log(`[crawl] ${id}: ${store.requeueDone(id, ['detail', 'json'])} URLs re-queued for conditional refresh`);
    const result = await fetchLoop(store, fetcher, id, adapter, { kinds: ['detail', 'json'], limit: opts.sample ?? Number.POSITIVE_INFINITY });
    console.log(`[crawl] ${id}: fetched ${result.fetched}${result.stopped ? ` (stopped: ${result.stopped})` : ''}`);
  }));
}

/** parse: run each source's isolated parser over fetched documents; failures are counted, never fatal. */
export function parseAll(store: StateStore, requested?: string[], rawStore = new RawStore()): Record<string, { docs: number; facts: number; invalid: number; failed: number; skipped: number }> {
  const stats: Record<string, { docs: number; facts: number; invalid: number; failed: number; skipped: number }> = {};
  for (const [id, adapter] of Object.entries(ADAPTERS)) {
    if (requested && !requested.includes(id)) continue;
    const s = (stats[id] = { docs: 0, facts: 0, invalid: 0, failed: 0, skipped: 0 });
    for (const row of store.unparsed(id, adapter.factKinds)) {
      s.docs++;
      const body = row.raw_path ? rawStore.read(row.raw_path) : null;
      if (!body) { store.saveParse(id, row.url, row.content_hash ?? '', row.fetched_at ?? '', [], 'raw snapshot missing (pruned?); re-crawl with --refresh'); s.failed++; continue; }
      const contentHash = sha256(body);
      try {
        const result = adapter.parse({ url: row.url, body, fetchedAt: row.fetched_at!, contentHash }, row.kind);
        s.skipped += result.skipped;
        const facts = [];
        for (const extracted of result.facts) {
          const candidate = { monograph_available: false, ...extracted, source_id: id, source_url: row.url, fetched_at: row.fetched_at, content_hash: contentHash };
          const parsed = RawFactSchema.safeParse(candidate);
          if (parsed.success) facts.push(parsed.data); else s.invalid++;
        }
        store.saveParse(id, row.url, row.content_hash ?? contentHash, row.fetched_at!, facts);
        s.facts += facts.length;
      } catch (error) {
        s.failed++;
        store.saveParse(id, row.url, row.content_hash ?? contentHash, row.fetched_at ?? '', [], (error as Error).message);
        store.logEvent(id, 'PARSE_FAILED', `${row.url}: ${(error as Error).message}`);
      }
    }
    console.log(`[parse] ${id}: docs=${s.docs} facts=${s.facts} skipped_rows=${s.skipped} invalid=${s.invalid} failed_docs=${s.failed}`);
  }
  return stats;
}
