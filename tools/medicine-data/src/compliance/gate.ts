import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import YAML from 'yaml';
import { COMPLIANCE_DIR, SOURCES, type SourceConfig, type Verdict } from '../config.js';
import { PoliteFetcher, RobotsUnavailableError, SourceBlockedError } from '../http/fetcher.js';
import type { RobotsPolicy } from '../http/robots.js';
import { permissionRequest } from './emails.js';

export interface Review {
  reviewed_verdict: Verdict;
  basis: string;
  quotes?: Array<{ url: string; text: string }>;
  needed_paths?: string[];
  endpoints?: Array<{ url: string; purpose: string }>;
  notes?: string[];
  permission_contact?: string;
  attribution?: string;
  legal_review_required?: boolean;
  listing?: Array<Record<string, string>>;
}

export interface TermsCheck {
  url: string;
  fetched_at?: string;
  sha256?: string;
  status?: number;
  error?: string;
  quotes_found: Array<{ text: string; found: boolean }>;
  auto_flags: string[];
}

export interface SourceVerdict {
  source: string;
  verdict: Verdict;
  reviewed_verdict: Verdict;
  legal_review_required: boolean;
  reasons: string[];
  robots?: { url: string; status: number; fetched_at: string; sha256: string | null; crawl_delay: number | null; sitemaps: string[]; disallow: string[]; needed_paths: Array<{ path: string; allowed: boolean }> };
  terms: TermsCheck[];
  checked_at: string;
}

export const VERDICTS_FILE = path.join(COMPLIANCE_DIR, 'verdicts.json');

export function loadReviews(file = path.join(COMPLIANCE_DIR, 'reviews.yaml')): Record<string, Review> {
  return YAML.parse(fs.readFileSync(file, 'utf8')) as Record<string, Review>;
}

export function loadVerdicts(): Record<string, SourceVerdict> {
  if (!fs.existsSync(VERDICTS_FILE)) throw new Error('No compliance verdicts found. Run `compliance` first; no crawling is permitted before the gate.');
  return JSON.parse(fs.readFileSync(VERDICTS_FILE, 'utf8')) as Record<string, SourceVerdict>;
}

/** Language that suggests a prohibition on automated access or reuse. */
const AUTO_FLAG = /\b(scrap(e|es|ing|er)|crawl(er|ers|ing)?|spiders?|robots?(?!\.txt)|bots?|automated (means|access|tools|systems|queries)|data[- ]mining|harvest(ing)?|extract(ing|ion)?|reproduc(e|tion)|republish|redistribut(e|ion)|derivative works?|non-commercial)\b/i;

const words = (s: string) => s.split(/\s+/).filter(Boolean);

/** Short (<25 words) excerpts around auto-flag hits, for the reviewer. */
export function autoFlags(text: string, max = 8): string[] {
  // Strip JSON-escaped markup (<…>) that some frameworks embed in page text.
  const sentences = text.replace(/\\u003c[\s\S]*?\\u003e/g, ' ').replace(/\s+/g, ' ').split(/(?<=[.!?।])\s+/);
  const out: string[] = [];
  for (const sentence of sentences) {
    if (!AUTO_FLAG.test(sentence)) continue;
    const w = words(sentence);
    const hit = w.findIndex(x => AUTO_FLAG.test(x));
    const start = Math.max(0, Math.min(hit - 10, w.length - 24));
    out.push(w.slice(start, start + 24).join(' ') + (w.length > 24 ? ' …' : ''));
    if (out.length >= max) break;
  }
  return out;
}

const normalizeForSearch = (s: string) => s.normalize('NFKC').replace(/[‘’´`]/g, "'").replace(/[“”]/g, '"').replace(/\\u0026/g, '&').replace(/\s+/g, ' ').toLowerCase();

export function combineVerdict(input: {
  reviewed: Verdict;
  blocked?: string;
  robotsUnavailable?: string;
  neededPaths: Array<{ path: string; allowed: boolean }>;
  unacknowledgedFlags: boolean;
  termsChanged: boolean;
  termsUnreadable: boolean;
}): { verdict: Verdict; reasons: string[] } {
  const reasons: string[] = [];
  if (input.reviewed === 'PROHIBITED') {
    return { verdict: 'PROHIBITED', reasons: ['Manual review: terms prohibit automated access or data reuse (never relaxed automatically).', ...(input.blocked ? [`Also blocked during gate: ${input.blocked}`] : [])] };
  }
  if (input.blocked) return { verdict: 'BLOCKED', reasons: [`Blocked during compliance gate: ${input.blocked}`] };
  if (input.robotsUnavailable) return { verdict: 'BLOCKED', reasons: [`robots.txt unavailable (treated as disallow-all): ${input.robotsUnavailable}`] };
  if (input.unacknowledgedFlags) return { verdict: 'PROHIBITED', reasons: ['Auto-scan found scraping/reuse language not covered by the manual review; PROHIBITED pending re-review.'] };
  let verdict: Verdict = input.reviewed;
  if (verdict === 'ALLOWED' && (input.termsChanged || input.termsUnreadable)) {
    verdict = 'UNCLEAR';
    reasons.push(input.termsChanged ? 'Terms content changed since the last gate run; re-review required.' : 'Terms page could not be fetched by the bot; conservative UNCLEAR.');
  }
  const denied = input.neededPaths.filter(p => !p.allowed);
  if (denied.length && denied.length === input.neededPaths.length && input.neededPaths.length) {
    return { verdict: 'RESTRICTED', reasons: [...reasons, `robots.txt disallows all needed paths (${denied.map(d => d.path).join(', ')}); nothing crawlable.`] };
  }
  if (denied.length) {
    verdict = 'RESTRICTED';
    reasons.push(`robots.txt disallows ${denied.map(d => d.path).join(', ')}; only permitted paths are crawled.`);
  }
  if (!reasons.length) reasons.push(`Manual review: ${input.reviewed}.`);
  return { verdict, reasons };
}

async function checkTerms(fetcher: PoliteFetcher, source: SourceConfig, url: string, review: Review): Promise<TermsCheck> {
  const quotes = (review.quotes ?? []).filter(q => q.url === url);
  const check: TermsCheck = { url, quotes_found: quotes.map(q => ({ text: q.text, found: false })), auto_flags: [] };
  try {
    const outcome = await fetcher.fetch(source.id, url, { countTowardsCap: false });
    if (outcome.kind === 'robots_disallowed') { check.error = 'robots.txt disallows fetching this terms page'; return check; }
    if (outcome.kind === 'http_error') { check.error = `${outcome.error} (${outcome.status})`; check.status = outcome.status; return check; }
    if (outcome.kind === 'not_modified') { check.status = 304; return check; }
    check.fetched_at = outcome.fetchedAt;
    check.sha256 = outcome.contentHash;
    check.status = outcome.status;
    const html = outcome.body.toString('utf8');
    const $ = cheerio.load(html);
    $('script:not([type="application/json"]):not(#__NEXT_DATA__), style, noscript').remove();
    const text = $('body').text();
    const haystack = normalizeForSearch(`${text} ${html}`);
    check.quotes_found = quotes.map(q => ({ text: q.text, found: haystack.includes(normalizeForSearch(q.text)) }));
    check.auto_flags = autoFlags(text);
  } catch (error) {
    if (error instanceof SourceBlockedError) throw error;
    check.error = (error as Error).message;
  }
  return check;
}

export async function runComplianceGate(fetcher: PoliteFetcher, onlySources?: string[]): Promise<Record<string, SourceVerdict>> {
  const reviews = loadReviews();
  const previous: Record<string, SourceVerdict> = fs.existsSync(VERDICTS_FILE) ? JSON.parse(fs.readFileSync(VERDICTS_FILE, 'utf8')) : {};
  const results: Record<string, SourceVerdict> = { ...previous };
  for (const source of SOURCES) {
    if (onlySources && !onlySources.includes(source.id)) continue;
    const review = reviews[source.id];
    if (!review) throw new Error(`compliance/reviews.yaml has no entry for ${source.id}`);
    console.log(`[compliance] ${source.id}`);
    const checkedAt = new Date().toISOString();
    let robots: RobotsPolicy | undefined;
    let blocked: string | undefined;
    let robotsUnavailable: string | undefined;
    const terms: TermsCheck[] = [];
    if (source.type !== 'app') {
      try {
        robots = await fetcher.robotsFor(source.id, source.origin);
        for (const url of source.termsUrls) terms.push(await checkTerms(fetcher, source, url, review));
      } catch (error) {
        if (error instanceof SourceBlockedError) blocked = error.message;
        else if (error instanceof RobotsUnavailableError) robotsUnavailable = error.message;
        else throw error;
      }
    }
    const neededPaths = robots ? (review.needed_paths ?? []).map(p => ({ path: p, allowed: robots!.isAllowed(new URL(p, source.origin).toString()) })) : [];
    const prevHashes = new Map((previous[source.id]?.terms ?? []).map(t => [t.url, t.sha256]));
    const termsChanged = terms.some(t => t.sha256 && prevHashes.get(t.url) && prevHashes.get(t.url) !== t.sha256);
    const termsUnreadable = source.termsUrls.length > 0 && terms.every(t => !t.sha256);
    // Flags are "acknowledged" when the manual review already considered prohibition language
    // (PROHIBITED) or the reviewer recorded the page as containing no such clause after reading it.
    const unacknowledgedFlags = review.reviewed_verdict !== 'PROHIBITED' && source.type !== 'regulator' && source.type !== 'open_dataset'
      && terms.some(t => t.auto_flags.some(f => /scrap|crawl|spider|robot|\bbots?\b|automated|data[- ]mining|harvest/i.test(f)));
    const { verdict, reasons } = combineVerdict({ reviewed: review.reviewed_verdict, blocked, robotsUnavailable, neededPaths, unacknowledgedFlags, termsChanged, termsUnreadable });
    const missingQuotes = terms.flatMap(t => t.quotes_found.filter(q => !q.found).map(q => q.text));
    if (missingQuotes.length) reasons.push(`${missingQuotes.length} reviewed quote(s) not found verbatim in the bot-fetched page (page may be JavaScript-rendered or reworded); manual review stands.`);
    results[source.id] = {
      source: source.id,
      verdict,
      reviewed_verdict: review.reviewed_verdict,
      legal_review_required: verdict === 'UNCLEAR' || !!review.legal_review_required,
      reasons,
      ...(robots ? { robots: { url: robots.robotsUrl, status: robots.status, fetched_at: robots.fetchedAt, sha256: robots.contentHash, crawl_delay: robots.crawlDelaySeconds ?? null, sitemaps: robots.sitemaps, disallow: robots.disallow, needed_paths: neededPaths, raw: robots.raw } as SourceVerdict['robots'] } : {}),
      terms,
      checked_at: checkedAt
    };
    writeSourceReport(source, review, results[source.id], robots);
    if (verdict === 'PROHIBITED' || source.id === 'dims_app') {
      fs.writeFileSync(path.join(COMPLIANCE_DIR, `${source.id}-permission-request.md`), permissionRequest(source, review));
    }
  }
  fs.writeFileSync(VERDICTS_FILE, JSON.stringify(results, null, 2));
  writeSummary(results, {});
  return results;
}

export function writeSourceReport(source: SourceConfig, review: Review, v: SourceVerdict, robots?: RobotsPolicy): void {
  const lines: string[] = [
    `# Compliance: ${source.id}`,
    '',
    `- Source: ${source.name}`,
    `- Origin: ${source.origin}`,
    `- Gate run: ${v.checked_at}`,
    `- **Verdict: ${v.verdict}**${v.legal_review_required ? ' · `LEGAL_REVIEW_REQUIRED`' : ''}`,
    `- Manual review verdict: ${v.reviewed_verdict}`,
    `- Basis: ${review.basis}`,
    ...v.reasons.map(r => `- Gate: ${r}`),
    ''
  ];
  lines.push('## robots.txt', '');
  if (source.type === 'app') {
    lines.push('Not fetched: this source is a mobile app. Only the public Play Store listing was read (in a browser) for ownership metadata. No APK download, decompilation, database extraction, traffic interception or private API use.', '');
  } else if (v.robots) {
    lines.push(
      `- URL: ${v.robots.url}`,
      `- HTTP status: ${v.robots.status}${v.robots.status === 404 || v.robots.status === 410 ? ' (no robots.txt → no restrictions)' : ''}`,
      `- Fetched: ${v.robots.fetched_at}`,
      `- SHA-256: ${v.robots.sha256 ?? 'n/a'}`,
      `- Crawl-delay: ${v.robots.crawl_delay ?? 'not specified (tool default 3–6 s)'}`,
      `- Sitemaps: ${v.robots.sitemaps.length ? v.robots.sitemaps.join(', ') : 'none'}`,
      `- Disallow (group applying to ${'HakeemifyMedicineIndexBot'}): ${v.robots.disallow.length ? v.robots.disallow.map(d => `\`${d}\``).join(', ') : 'none'}`,
      `- Needed paths: ${v.robots.needed_paths.map(p => `\`${p.path}\` ${p.allowed ? 'allowed' : '**disallowed**'}`).join(', ') || 'none'}`,
      ''
    );
    if (robots?.status === 200) lines.push('```text', robots.raw.trim().slice(0, 4000), '```', '');
  } else {
    lines.push('robots.txt could not be evaluated (see gate reasons).', '');
  }
  lines.push('## Terms of use', '');
  if (!v.terms.length) lines.push(source.type === 'app' ? 'Not applicable (see listing below).' : 'No terms page configured / found.', '');
  for (const t of v.terms) {
    lines.push(`### ${t.url}`, '', `- Fetched: ${t.fetched_at ?? 'not fetched'}`, `- HTTP status: ${t.status ?? 'n/a'}`, `- SHA-256: ${t.sha256 ?? 'n/a'}`);
    if (t.error) lines.push(`- Fetch error: ${t.error}`);
    lines.push('');
    if (t.quotes_found.length) {
      lines.push('Reviewed clauses (verbatim, < 25 words):', '');
      for (const q of t.quotes_found) lines.push(`- "${q.text}" — ${q.found ? 'present in bot-fetched page' : 'not found verbatim in bot-fetched page'}`);
      lines.push('');
    }
    if (t.auto_flags.length) {
      lines.push('Auto-scan excerpts for reviewer attention (< 25 words each):', '');
      for (const f of t.auto_flags) lines.push(`- "${f}"`);
      lines.push('');
    }
  }
  if (review.endpoints?.length) {
    lines.push('## Public endpoints used', '');
    for (const e of review.endpoints) lines.push(`- \`${e.url}\` — ${e.purpose}`);
    lines.push('');
  }
  if (review.listing?.length) {
    lines.push('## Play Store listing (public, read for ownership only)', '');
    for (const l of review.listing) lines.push(...Object.entries(l).map(([k, val]) => `- ${k}: ${val}`), '');
  }
  if (review.notes?.length) lines.push('## Notes', '', ...review.notes.map(n => `- ${n}`), '');
  if (review.attribution) lines.push('## Required attribution', '', review.attribution, '');
  if (review.permission_contact) lines.push('## Permission contact', '', review.permission_contact, '');
  fs.writeFileSync(path.join(COMPLIANCE_DIR, `${source.id}.md`), lines.join('\n'));
}

export function writeSummary(verdicts: Record<string, SourceVerdict>, contributed: Record<string, number>): void {
  const lines = [
    '# Compliance summary',
    '',
    `Generated: ${new Date().toISOString()}. Crawling is permitted only for ALLOWED, RESTRICTED (permitted paths) and UNCLEAR (conservative caps) sources.`,
    '',
    '| Source | Verdict | Legal review | Records contributed | Reason |',
    '|---|---|---|---:|---|'
  ];
  for (const source of SOURCES) {
    const v = verdicts[source.id];
    if (!v) { lines.push(`| ${source.id} | not run | – | 0 | – |`); continue; }
    lines.push(`| ${source.id} | ${v.verdict} | ${v.legal_review_required ? 'LEGAL_REVIEW_REQUIRED' : '–'} | ${contributed[source.id] ?? 0} | ${v.reasons.join(' ').replace(/\|/g, '/')} |`);
  }
  lines.push('', 'Permission-request emails: see `*-permission-request.md` in this folder.', '');
  fs.writeFileSync(path.join(COMPLIANCE_DIR, 'SUMMARY.md'), lines.join('\n'));
}
