import type { Link } from '../types.js';

export const DGDA_BASE = 'http://180.211.137.202:9310/Allopathic';
export const DGDA_EXPORT_URL = `${DGDA_BASE}/Medicine_Information_Ajax.php?action=export`;
/** DataTables page size for the fallback; larger pages mean fewer requests to a small government server. */
export const DGDA_PAGE_SIZE = 500;

export function listUrl(start: number, length = DGDA_PAGE_SIZE): string {
  return `${DGDA_BASE}/Medicine_Information_Ajax.php?action=list&draw=1&start=${start}&length=${length}`;
}

/** One request for the whole registry via the page's own export button. */
export function seeds(): Link[] {
  return [{ url: DGDA_EXPORT_URL, kind: 'detail' }];
}

/** If export fails, page through the list endpoint: first page reveals recordsTotal. */
export function fallbackSeeds(failedUrl: string): Link[] {
  return failedUrl === DGDA_EXPORT_URL ? [{ url: listUrl(0), kind: 'json' }] : [];
}

export function extractLinks(body: Buffer, url: string): Link[] {
  if (!url.includes('action=list') || !/[?&]start=0(&|$)/.test(url)) return [];
  try {
    const json = JSON.parse(body.toString('utf8')) as { recordsTotal?: number | string };
    const total = Number(json.recordsTotal ?? 0);
    const links: Link[] = [];
    for (let start = DGDA_PAGE_SIZE; start < total; start += DGDA_PAGE_SIZE) links.push({ url: listUrl(start), kind: 'json' });
    return links;
  } catch {
    return [];
  }
}
