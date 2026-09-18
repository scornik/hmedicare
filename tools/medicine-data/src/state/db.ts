import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { STATE_DIR } from '../config.js';

export type UrlKind = 'sitemap' | 'listing' | 'detail' | 'json';
export type FrontierStatus = 'pending' | 'done' | 'not_modified' | 'failed' | 'robots_disallowed' | 'skipped';

export interface FrontierRow {
  source: string;
  url: string;
  kind: UrlKind;
  status: FrontierStatus;
  discovered_at: string;
  fetched_at: string | null;
  http_status: number | null;
  content_hash: string | null;
  raw_path: string | null;
  etag: string | null;
  last_modified: string | null;
  attempts: number;
  error: string | null;
}

export interface FactRow { source: string; url: string; content_hash: string; fetched_at: string; fact_json: string; }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS frontier (
  source TEXT NOT NULL, url TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  discovered_at TEXT NOT NULL, fetched_at TEXT, http_status INTEGER, content_hash TEXT, raw_path TEXT,
  etag TEXT, last_modified TEXT, attempts INTEGER NOT NULL DEFAULT 0, error TEXT,
  PRIMARY KEY (source, url)
);
CREATE INDEX IF NOT EXISTS frontier_pending ON frontier (source, status, kind);
CREATE TABLE IF NOT EXISTS request_counts (host TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (host, day));
CREATE TABLE IF NOT EXISTS host_last_request (host TEXT PRIMARY KEY, at_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS source_status (source TEXT PRIMARY KEY, status TEXT NOT NULL, reason TEXT, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, source TEXT, type TEXT NOT NULL, detail TEXT);
CREATE TABLE IF NOT EXISTS parse_results (
  source TEXT NOT NULL, url TEXT NOT NULL, content_hash TEXT NOT NULL, parsed_at TEXT NOT NULL,
  status TEXT NOT NULL, error TEXT, PRIMARY KEY (source, url)
);
CREATE TABLE IF NOT EXISTS facts (
  source TEXT NOT NULL, url TEXT NOT NULL, idx INTEGER NOT NULL, content_hash TEXT NOT NULL, fetched_at TEXT NOT NULL,
  fact_json TEXT NOT NULL, PRIMARY KEY (source, url, idx)
);
`;

export class StateStore {
  readonly db: Database.Database;

  constructor(file = path.join(STATE_DIR, 'crawl.sqlite')) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  close(): void { this.db.close(); }

  enqueue(source: string, url: string, kind: UrlKind): boolean {
    const result = this.db.prepare(`INSERT OR IGNORE INTO frontier (source, url, kind, discovered_at) VALUES (?, ?, ?, ?)`)
      .run(source, url, kind, new Date().toISOString());
    return result.changes > 0;
  }

  get(source: string, url: string): FrontierRow | undefined {
    return this.db.prepare(`SELECT * FROM frontier WHERE source = ? AND url = ?`).get(source, url) as FrontierRow | undefined;
  }

  /** Sitemaps first, then listings, then detail pages (discovery order from the crawl policy). */
  nextPending(source: string, kinds: UrlKind[], limit: number): FrontierRow[] {
    const placeholders = kinds.map(() => '?').join(',');
    return this.db.prepare(`SELECT * FROM frontier WHERE source = ? AND status = 'pending' AND kind IN (${placeholders})
      ORDER BY CASE kind WHEN 'sitemap' THEN 0 WHEN 'listing' THEN 1 WHEN 'json' THEN 2 ELSE 3 END, rowid LIMIT ?`)
      .all(source, ...kinds, limit) as FrontierRow[];
  }

  /** Rows due for a conditional re-fetch (used by `crawl --refresh`). */
  requeueDone(source: string, kinds: UrlKind[]): number {
    const placeholders = kinds.map(() => '?').join(',');
    return this.db.prepare(`UPDATE frontier SET status = 'pending' WHERE source = ? AND status IN ('done','not_modified') AND kind IN (${placeholders})`)
      .run(source, ...kinds).changes;
  }

  markFetched(source: string, url: string, update: Partial<FrontierRow> & { status: FrontierStatus }): void {
    const current = this.get(source, url);
    const next = { ...current, ...update } as FrontierRow;
    this.db.prepare(`UPDATE frontier SET status = ?, fetched_at = ?, http_status = ?, content_hash = ?, raw_path = ?, etag = ?,
      last_modified = ?, attempts = attempts + 1, error = ? WHERE source = ? AND url = ?`)
      .run(next.status, next.fetched_at ?? null, next.http_status ?? null, next.content_hash ?? null, next.raw_path ?? null,
        next.etag ?? null, next.last_modified ?? null, update.error ?? null, source, url);
  }

  countsBySource(): Array<{ source: string; kind: string; status: string; n: number }> {
    return this.db.prepare(`SELECT source, kind, status, COUNT(*) n FROM frontier GROUP BY source, kind, status ORDER BY source, kind, status`).all() as never;
  }

  requestsToday(host: string, day = utcDay()): number {
    const row = this.db.prepare(`SELECT count FROM request_counts WHERE host = ? AND day = ?`).get(host, day) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  incrementRequests(host: string, day = utcDay()): void {
    this.db.prepare(`INSERT INTO request_counts (host, day, count) VALUES (?, ?, 1) ON CONFLICT(host, day) DO UPDATE SET count = count + 1`).run(host, day);
  }

  lastRequestAt(host: string): number | undefined {
    return (this.db.prepare(`SELECT at_ms FROM host_last_request WHERE host = ?`).get(host) as { at_ms: number } | undefined)?.at_ms;
  }

  setLastRequestAt(host: string, atMs: number): void {
    this.db.prepare(`INSERT INTO host_last_request (host, at_ms) VALUES (?, ?) ON CONFLICT(host) DO UPDATE SET at_ms = excluded.at_ms`).run(host, atMs);
  }

  sourceStatus(source: string): { status: string; reason: string | null; at: string } | undefined {
    return this.db.prepare(`SELECT status, reason, at FROM source_status WHERE source = ?`).get(source) as never;
  }

  setSourceStatus(source: string, status: 'ACTIVE' | 'BLOCKED', reason: string): void {
    this.db.prepare(`INSERT INTO source_status (source, status, reason, at) VALUES (?, ?, ?, ?)
      ON CONFLICT(source) DO UPDATE SET status = excluded.status, reason = excluded.reason, at = excluded.at`)
      .run(source, status, reason, new Date().toISOString());
  }

  logEvent(source: string | null, type: string, detail: string): void {
    this.db.prepare(`INSERT INTO events (at, source, type, detail) VALUES (?, ?, ?, ?)`).run(new Date().toISOString(), source, type, detail);
  }

  events(source?: string): Array<{ at: string; source: string; type: string; detail: string }> {
    return (source
      ? this.db.prepare(`SELECT at, source, type, detail FROM events WHERE source = ? ORDER BY id`).all(source)
      : this.db.prepare(`SELECT at, source, type, detail FROM events ORDER BY id`).all()) as never;
  }

  /** Detail pages fetched with a body whose content hash has not been parsed yet. */
  unparsed(source: string, kinds: UrlKind[] = ['detail', 'json']): FrontierRow[] {
    const placeholders = kinds.map(() => '?').join(',');
    return this.db.prepare(`SELECT f.* FROM frontier f LEFT JOIN parse_results p ON p.source = f.source AND p.url = f.url
      WHERE f.source = ? AND f.kind IN (${placeholders}) AND f.status IN ('done','not_modified') AND f.raw_path IS NOT NULL
      AND (p.content_hash IS NULL OR p.content_hash <> f.content_hash)`).all(source, ...kinds) as FrontierRow[];
  }

  /** Forces re-parsing (after a parser fix) without re-fetching. */
  resetParse(source: string): number {
    this.db.prepare(`DELETE FROM facts WHERE source = ?`).run(source);
    return this.db.prepare(`DELETE FROM parse_results WHERE source = ?`).run(source).changes;
  }

  saveParse(source: string, url: string, contentHash: string, fetchedAt: string, facts: unknown[], error?: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM facts WHERE source = ? AND url = ?`).run(source, url);
      facts.forEach((fact, idx) => this.db.prepare(`INSERT INTO facts (source, url, idx, content_hash, fetched_at, fact_json) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(source, url, idx, contentHash, fetchedAt, JSON.stringify(fact)));
      this.db.prepare(`INSERT INTO parse_results (source, url, content_hash, parsed_at, status, error) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(source, url) DO UPDATE SET content_hash = excluded.content_hash, parsed_at = excluded.parsed_at, status = excluded.status, error = excluded.error`)
        .run(source, url, contentHash, new Date().toISOString(), error ? 'failed' : facts.length ? 'ok' : 'empty', error ?? null);
    });
    tx();
  }

  parseStats(): Array<{ source: string; status: string; n: number }> {
    return this.db.prepare(`SELECT source, status, COUNT(*) n FROM parse_results GROUP BY source, status`).all() as never;
  }

  parseErrors(limit = 20): Array<{ source: string; url: string; error: string }> {
    return this.db.prepare(`SELECT source, url, error FROM parse_results WHERE status = 'failed' LIMIT ?`).all(limit) as never;
  }

  allFacts(): FactRow[] {
    return this.db.prepare(`SELECT source, url, content_hash, fetched_at, fact_json FROM facts ORDER BY source, url, idx`).all() as FactRow[];
  }
}

export function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}
