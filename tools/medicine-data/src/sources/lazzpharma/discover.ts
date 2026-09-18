import * as cheerio from 'cheerio';
import type { FetchedDoc, Link } from '../types.js';

export const LAZZ_ORIGIN = 'https://lazzpharma.com';

/** No sitemap exists; the server-rendered homepage is the only public listing that needs no JavaScript. */
export function seeds(): Link[] {
  return [{ url: `${LAZZ_ORIGIN}/`, kind: 'listing' }];
}

export function extractLinks(doc: FetchedDoc): Link[] {
  const $ = cheerio.load(doc.body.toString('utf8'));
  const urls = new Set<string>();
  $('#ssr-home a[href*="/product/details/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) urls.add(new URL(href, LAZZ_ORIGIN).toString());
  });
  return [...urls].map(url => ({ url, kind: 'detail' as const }));
}
