import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectiveCap, effectiveDelays, requireContactEmail } from '../src/config.js';
import { detectChallenge } from '../src/http/challenge.js';
import { CapReachedError, PoliteFetcher, SourceBlockedError } from '../src/http/fetcher.js';
import { RawStore } from '../src/http/raw-store.js';
import { StateStore } from '../src/state/db.js';

const ENV = { CONTACT_EMAIL: 'data-team@hakeemify-test.org' } as NodeJS.ProcessEnv;
const ROBOTS = 'User-agent: *\nDisallow: /private/\nCrawl-delay: 10\nSitemap: https://site.test-host.org/sitemap.xml\n';

type Handler = (url: string, init?: RequestInit) => Response;

function setup(handler: Handler, opts: { cap?: number } = {}) {
  const store = new StateStore(':memory:');
  const rawDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-raw-'));
  let clock = 1_000_000;
  const sleeps: number[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => handler(String(input), init));
  const fetcher = new PoliteFetcher({
    store,
    env: ENV,
    delays: { minMs: 3000, maxMs: 6000 },
    capFor: () => opts.cap ?? 5000,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async ms => { sleeps.push(ms); clock += ms; },
    random: () => 0,
    now: () => clock,
    rawStore: new RawStore(rawDir),
    sourcesForHost: host => (host === 'site.test-host.org' ? ['src_a', 'src_b'] : [])
  });
  return { store, fetcher, fetchImpl, sleeps };
}

const robotsOr = (other: Handler): Handler => (url, init) => (url.endsWith('/robots.txt') ? new Response(ROBOTS, { status: 200 }) : other(url, init));

describe('contact email gate', () => {
  const original = process.env.CONTACT_EMAIL;
  beforeEach(() => { delete process.env.CONTACT_EMAIL; });
  afterEach(() => { if (original !== undefined) process.env.CONTACT_EMAIL = original; });

  it('refuses to run without CONTACT_EMAIL', () => {
    expect(() => requireContactEmail({})).toThrow(/CONTACT_EMAIL is required/);
    expect(() => new PoliteFetcher({ store: new StateStore(':memory:'), delays: { minMs: 3000, maxMs: 6000 }, capFor: () => 1 })).toThrow(/CONTACT_EMAIL is required/);
  });

  it('rejects malformed and placeholder addresses', () => {
    expect(() => requireContactEmail({ CONTACT_EMAIL: 'not-an-email' })).toThrow(/not a valid/);
    expect(() => requireContactEmail({ CONTACT_EMAIL: 'data@hakeemify.example' })).toThrow(/placeholder/);
    expect(() => requireContactEmail({ CONTACT_EMAIL: 'me@example.com' })).toThrow(/placeholder/);
  });

  it('puts the contact address in the bot user-agent', async () => {
    const { fetcher, fetchImpl } = setup(robotsOr(() => new Response('<html></html>', { status: 200 })));
    await fetcher.fetch('src_a', 'https://site.test-host.org/page');
    const headers = fetchImpl.mock.calls[1][1]!.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe('HakeemifyMedicineIndexBot/1.0 (+contact: data-team@hakeemify-test.org)');
  });
});

describe('robots.txt enforcement', () => {
  it('refuses disallowed paths without requesting them', async () => {
    const { fetcher, fetchImpl, store } = setup(robotsOr(() => { throw new Error('must not fetch'); }));
    const outcome = await fetcher.fetch('src_a', 'https://site.test-host.org/private/list');
    expect(outcome.kind).toBe('robots_disallowed');
    expect(fetchImpl).toHaveBeenCalledTimes(1); // robots.txt only
    expect(store.events('src_a').map(e => e.type)).toContain('ROBOTS_DISALLOWED');
  });

  it('honours Crawl-delay when larger than the randomized default delay', async () => {
    const { fetcher, sleeps } = setup(robotsOr(() => new Response('ok', { status: 200 })));
    await fetcher.fetch('src_a', 'https://site.test-host.org/a');
    await fetcher.fetch('src_a', 'https://site.test-host.org/b');
    expect(sleeps.every(ms => ms >= 10_000)).toBe(true);
    expect(sleeps.length).toBeGreaterThanOrEqual(2);
  });

  it('does not follow redirects into disallowed paths', async () => {
    const { fetcher } = setup(robotsOr(url => (url.endsWith('/go') ? new Response(null, { status: 301, headers: { location: '/private/x' } }) : new Response('x'))));
    expect((await fetcher.fetch('src_a', 'https://site.test-host.org/go')).kind).toBe('robots_disallowed');
  });
});

describe('stop on block', () => {
  for (const status of [403, 429]) {
    it(`stops the source (and sources sharing the host) on HTTP ${status}`, async () => {
      const { fetcher, fetchImpl, store } = setup(robotsOr(() => new Response('no', { status })));
      await expect(fetcher.fetch('src_a', 'https://site.test-host.org/p1')).rejects.toBeInstanceOf(SourceBlockedError);
      const calls = fetchImpl.mock.calls.length;
      await expect(fetcher.fetch('src_a', 'https://site.test-host.org/p2')).rejects.toBeInstanceOf(SourceBlockedError);
      await expect(fetcher.fetch('src_b', 'https://site.test-host.org/p3')).rejects.toBeInstanceOf(SourceBlockedError);
      expect(fetchImpl.mock.calls.length).toBe(calls); // no retries, no further requests
      expect(store.sourceStatus('src_a')?.status).toBe('BLOCKED');
      expect(store.sourceStatus('src_b')?.status).toBe('BLOCKED');
    });
  }

  it('stops on a bot-challenge page even with HTTP 200', async () => {
    const challenge = '<html><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/h/b/orchestrate"></script></body></html>';
    const { fetcher, store } = setup(robotsOr(() => new Response(challenge, { status: 200 })));
    await expect(fetcher.fetch('src_a', 'https://site.test-host.org/p')).rejects.toBeInstanceOf(SourceBlockedError);
    expect(store.sourceStatus('src_a')?.reason).toMatch(/challenge/);
  });

  it('does not mistake an ordinary page that mentions cloudflare for a challenge', () => {
    expect(detectChallenge(200, {}, '<html><script src="https://cdnjs.cloudflare.com/x.js"></script><p>captcha-free</p></html>')).toBeNull();
    expect(detectChallenge(200, { 'cf-mitigated': 'challenge' }, '')).not.toBeNull();
  });
});

describe('licensed file redirects to object storage', () => {
  const bucket = 'https://bucket.s3.amazonaws.com';
  const handler = (fileStatus: number): Handler => url => {
    if (url === 'https://site.test-host.org/robots.txt') return new Response(ROBOTS);
    if (url === 'https://site.test-host.org/file') return new Response(null, { status: 302, headers: { location: `${bucket}/data.csv?sig=1` } });
    if (url === `${bucket}/robots.txt`) return new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 });
    if (url.startsWith(`${bucket}/data.csv`)) return new Response('a,b\n1,2', { status: fileStatus });
    throw new Error(`unexpected ${url}`);
  };

  it('treats an object-storage robots.txt 403 as absent only for listed redirect hosts', async () => {
    const { fetcher, store } = setup(handler(200));
    const ok = await fetcher.fetch('src_a', 'https://site.test-host.org/file', { redirectHosts: ['amazonaws.com'] });
    expect(ok.kind).toBe('ok');
    expect(store.events('src_a').map(e => e.type)).toContain('ROBOTS_ABSENT_OBJECT_STORAGE');
  });

  it('refuses the redirect when the host is not listed', async () => {
    const { fetcher } = setup(handler(200));
    expect((await fetcher.fetch('src_a', 'https://site.test-host.org/file')).kind).toBe('http_error');
  });

  it('still stops the source when the file itself returns 403', async () => {
    const { fetcher } = setup(handler(403));
    await expect(fetcher.fetch('src_a', 'https://site.test-host.org/file', { redirectHosts: ['amazonaws.com'] })).rejects.toBeInstanceOf(SourceBlockedError);
  });
});

describe('caps, delays and caching', () => {
  it('stops at the daily per-host cap', async () => {
    const { fetcher } = setup(robotsOr(() => new Response('ok')), { cap: 3 }); // robots.txt counts as a request too
    await fetcher.fetch('src_a', 'https://site.test-host.org/1');
    await fetcher.fetch('src_a', 'https://site.test-host.org/2');
    await expect(fetcher.fetch('src_a', 'https://site.test-host.org/3')).rejects.toBeInstanceOf(CapReachedError);
  });

  it('sends conditional headers and reports 304 as not modified', async () => {
    const { fetcher, fetchImpl } = setup(robotsOr(() => new Response(null, { status: 304 })));
    const outcome = await fetcher.fetch('src_a', 'https://site.test-host.org/x', { etag: '"abc"', lastModified: 'Wed, 16 Sep 2026 10:00:00 GMT' });
    expect(outcome.kind).toBe('not_modified');
    const headers = fetchImpl.mock.calls[1][1]!.headers as Record<string, string>;
    expect(headers['If-None-Match']).toBe('"abc"');
    expect(headers['If-Modified-Since']).toBe('Wed, 16 Sep 2026 10:00:00 GMT');
  });

  it('only allows delays and UNCLEAR caps to move in the conservative direction', () => {
    expect(effectiveDelays({ minDelayMs: 1000, maxDelayMs: 2000 })).toEqual({ minMs: 3000, maxMs: 6000 });
    expect(effectiveDelays({ minDelayMs: 8000 })).toEqual({ minMs: 8000, maxMs: 8000 });
    expect(effectiveCap('lazzpharma', 'UNCLEAR', { caps: { lazzpharma: 99_999 } })).toBe(1500);
    expect(effectiveCap('lazzpharma', 'UNCLEAR', {})).toBe(1500);
    expect(effectiveCap('dgda', 'ALLOWED', {})).toBe(5000);
    expect(effectiveCap('medex', 'PROHIBITED', { caps: { medex: 10 } })).toBe(0);
  });
});
