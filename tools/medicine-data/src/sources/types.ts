import type { RawFact } from '../schemas.js';
import type { UrlKind } from '../state/db.js';

export interface Link { url: string; kind: UrlKind }

export interface FetchedDoc {
  url: string;
  body: Buffer;
  fetchedAt: string;
  contentHash: string;
  contentType?: string;
}

/** Fields the adapter extracts; provenance fields are filled by the pipeline. */
export type ExtractedFact = Omit<RawFact, 'source_id' | 'source_url' | 'fetched_at' | 'content_hash' | 'monograph_available'> & { monograph_available?: boolean };

export interface ParseResult { facts: ExtractedFact[]; skipped: number; warnings: string[] }

/**
 * One isolated adapter per source. A layout change breaks only this adapter;
 * the pipeline counts parse failures instead of crashing.
 */
export interface SourceAdapter {
  id: string;
  /** Seeds in discovery order: sitemaps, then listing pages, then direct detail/export URLs. */
  seeds(sitemaps: string[]): Link[];
  /** Follow-up links from a fetched sitemap or listing page. */
  extractLinks?(doc: FetchedDoc, kind: UrlKind): Link[];
  /** URL kinds whose bodies contain facts. */
  factKinds: UrlKind[];
  parse(doc: FetchedDoc, kind: UrlKind): ParseResult;
  /** Accept header for fact documents. */
  accept?: string;
  /** Known SHA-256 of immutable files (verified after download). */
  expectedSha256?: Record<string, string>;
  /** Hosts an export/file URL may legitimately redirect to (e.g. object storage). */
  redirectHosts?: string[];
  /** Seeds to use when a primary export URL fails. */
  fallbackSeeds?(failedUrl: string): Link[];
}
