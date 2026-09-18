import fs from 'node:fs';
import path from 'node:path';
import { DIST_DIR, RUNS_DIR, SOURCES } from '../config.js';
import { loadReviews, loadVerdicts, writeSummary } from '../compliance/gate.js';
import { AUTO_MERGE_THRESHOLD, MIN_BRAND_SIMILARITY_FOR_AUTO, REVIEW_THRESHOLD } from '../resolve/fuzzy.js';
import type { StateStore } from '../state/db.js';
import { finalizeVersion } from './dataset.js';
import { readJsonl } from './jsonl.js';

export const PRODUCTION_GATES = [
  'Legal/terms review for every contributing source marked `UNCLEAR` (or flagged `LEGAL_REVIEW_REQUIRED`), or written permission for `PROHIBITED` sources.',
  'A clinician/pharmacist review of a random sample of records, with documented sample size and error rate.',
  'The DGDA cross-reference is completed where public data allows.',
  'The product import shows a "catalog source" indicator, keeps free-text fallback, and never uses scraped text as dosing guidance.'
];

type Row = Record<string, unknown>;
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a');

export function latestVersionDir(): { version: string; dir: string } {
  const versions = fs.existsSync(DIST_DIR) ? fs.readdirSync(DIST_DIR).filter(n => n.startsWith('medicine-dataset-')).sort() : [];
  if (!versions.length) throw new Error('No exported dataset found; run `export` first.');
  // Prefer the newest directory (export may have run after the last report).
  const version = versions.sort((a, b) => {
    const [da, na] = a.replace('medicine-dataset-', '').split('-').map(Number);
    const [db, nb] = b.replace('medicine-dataset-', '').split('-').map(Number);
    return da - db || na - nb;
  }).at(-1)!;
  return { version, dir: path.join(DIST_DIR, version) };
}

/** report: dataset card, compliance SUMMARY record counts, checksums, latest.json and a run log. */
export function reportStage(store: StateStore, runNotes: string[] = []): { version: string; card: string; runLog: string; summary: Record<string, unknown> } {
  const { version, dir } = latestVersionDir();
  const verdicts = loadVerdicts();
  const reviews = loadReviews();
  const load = (f: string) => readJsonl<Row>(path.join(dir, f));
  const meds = load('medications.jsonl');
  const generics = load('generics.jsonl');
  const manufacturers = load('manufacturers.jsonl');
  const aliases = load('aliases.jsonl');
  const prices = load('prices_observed.jsonl');
  const provenance = load('provenance.jsonl');
  const conflicts = load('conflicts.jsonl');
  const review = load('review_queue.jsonl');
  const normalizeReport = JSON.parse(fs.readFileSync(path.join(dir, 'reports', 'normalize-report.json'), 'utf8')) as { input: number; collapsed: number; invalid_count: number; unmapped_forms: Array<{ raw: string; count: number; sources: string[] }>; excluded_prohibited: Record<string, number>; manufacturer_merges: unknown[] };
  const validation = JSON.parse(fs.readFileSync(path.join(dir, 'reports', 'export-validation.json'), 'utf8')) as { invalid: Record<string, unknown[]> };

  const contributed: Record<string, number> = {};
  for (const p of provenance) contributed[String(p.source_id)] = (contributed[String(p.source_id)] ?? 0) + 1;
  const productsBySource: Record<string, Set<string>> = {};
  for (const p of provenance) (productsBySource[String(p.source_id)] ??= new Set()).add(String(p.medication_id));
  const forms = new Map<string, number>();
  for (const m of meds) { const f = String((m.dosage_form as Row).value); forms.set(f, (forms.get(f) ?? 0) + 1); }
  const dgda = { MATCHED: 0, NOT_FOUND: 0, AMBIGUOUS: 0, NOT_CHECKED: 0 } as Record<string, number>;
  for (const m of meds) dgda[String(m.dgda_match)]++;
  const nonDgdaOnly = meds.filter(m => (m.source_ids as string[]).some(s => s !== 'dgda'));
  const nonDgdaMatched = nonDgdaOnly.filter(m => m.dgda_match === 'MATCHED').length;
  const multiSource = meds.filter(m => (m.source_ids as string[]).length > 1).length;
  const aliasCounts = { source: aliases.filter(a => a.alias_origin === 'source').length, generated: aliases.filter(a => a.alias_origin === 'generated').length };
  const fuzzyAuto = provenance.filter(p => p.match_method === 'fuzzy_auto').length;
  const reviewByType: Record<string, number> = {};
  for (const r of review) reviewByType[String(r.type)] = (reviewByType[String(r.type)] ?? 0) + 1;
  const conflictByField: Record<string, number> = {};
  for (const c of conflicts) conflictByField[String(c.field)] = (conflictByField[String(c.field)] ?? 0) + 1;

  const completenessFields = ['brand_name', 'brand_name_bn', 'generic_names', 'strength', 'dosage_form', 'route', 'manufacturer', 'pack_size', 'registration_number', 'therapeutic_class'];
  const filled = (m: Row, f: string) => {
    const v = m[f] as Row | undefined;
    if (!v) return false;
    const value = v.value;
    if (f === 'dosage_form') return value !== 'unmapped';
    return value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && !value.length);
  };
  const medsWithPrice = new Set(prices.map(p => String(p.medication_id)));

  const parseStats = store.parseStats();
  const parseErrors = store.parseErrors(10);
  const blockedEvents = store.events().filter(e => ['BLOCKED', 'UNBLOCK_MANUAL', 'ROBOTS_ABSENT_OBJECT_STORAGE', 'CAP_REACHED', 'ROBOTS_UNAVAILABLE', 'CHECKSUM_MISMATCH', 'FALLBACK', 'PARSE_FAILED'].includes(e.type));
  const frontier = store.countsBySource();

  const now = new Date().toISOString();
  const L: string[] = [];
  L.push(`# Dataset card: ${version}`, '');
  L.push('> **Status: UNVERIFIED.** May be imported into local, dev and staging environments only. Production import requires every gate listed under "Production gates". **This data is not clinical guidance.** It lists factual product attributes (names, strengths, forms, manufacturers, registration numbers, observed prices). It must never be presented as prescribing or dosing guidance.', '');
  L.push('## Version', '', `- Dataset version: \`${version}\``, `- Build date: ${now}`, '- Status: `UNVERIFIED`', '- Built by: `tools/medicine-data` (HakeemifyMedicineIndexBot/1.0)', '- Import contract: defined by Stage 3.2', '');

  L.push('## Sources and compliance', '', '| Source | Verdict | Legal review | Source records contributed | Canonical products touched |', '|---|---|---|---:|---:|');
  for (const s of SOURCES) {
    const v = verdicts[s.id];
    L.push(`| ${s.id} | ${v?.verdict ?? 'not run'} | ${v?.legal_review_required ? 'LEGAL_REVIEW_REQUIRED' : '–'} | ${contributed[s.id] ?? 0} | ${productsBySource[s.id]?.size ?? 0} |`);
  }
  L.push('', 'Details for each source are in `tools/medicine-data/compliance/<source>.md`. PROHIBITED sources contributed no records; permission-request emails are in `compliance/*-permission-request.md`.', '');
  if (Object.keys(normalizeReport.excluded_prohibited).length) L.push(`Facts excluded because their source is now PROHIBITED: ${JSON.stringify(normalizeReport.excluded_prohibited)}`, '');
  const attributions = Object.entries(reviews).filter(([id, r]) => r.attribution && contributed[id]).map(([, r]) => r.attribution!);
  if (attributions.length) L.push('### Required attribution', '', ...attributions.map(a => `- ${a}`), '');

  L.push('## Coverage', '',
    `- Canonical products (medications.jsonl): **${meds.length}**`,
    `- Products backed by more than one source: ${multiSource} (${pct(multiSource, meds.length)})`,
    `- Generics: ${generics.length}`,
    `- Manufacturers: ${manufacturers.length}`,
    `- Aliases: ${aliases.length} (from sources: ${aliasCounts.source}; machine-generated search aliases: ${aliasCounts.generated})`,
    `- Price observations: ${prices.length} (products with at least one observed price: ${medsWithPrice.size}). Prices are per-source observations, never merged, and are not official MRP unless \`is_official_mrp\` is true.`,
    `- Source records → canonical links (provenance.jsonl): ${provenance.length} (fuzzy auto-merged: ${fuzzyAuto})`,
    '', '### Dosage forms', '', '| Form | Products |', '|---|---:|',
    ...[...forms.entries()].sort((a, b) => b[1] - a[1]).map(([f, n]) => `| ${f} | ${n} |`), '');

  L.push('## DGDA cross-reference', '',
    `- DGDA registry loaded: ${meds.some(m => (m.source_ids as string[]).includes('dgda')) ? 'yes' : 'no'}`,
    `- All products: MATCHED ${dgda.MATCHED} (${pct(dgda.MATCHED, meds.length)}), NOT_FOUND ${dgda.NOT_FOUND}, AMBIGUOUS ${dgda.AMBIGUOUS}, NOT_CHECKED ${dgda.NOT_CHECKED}`,
    `- **DGDA match rate for products that have a non-DGDA source: ${pct(nonDgdaMatched, nonDgdaOnly.length)}** (${nonDgdaMatched} of ${nonDgdaOnly.length})`,
    '- MATCHED means the canonical record contains at least one DGDA registration (DAR number). Several DAR numbers for one product (the same product registered at different plants of one company) are all kept in `registration_number.alternatives`. AMBIGUOUS means a near DGDA match is waiting in the review queue.',
    '- NOT_FOUND does not mean a product is unregistered. The DGDA export used is the "Allopathic Medicine Information" list, which appears to cover locally manufactured products; imported drugs are on a separate DGDA list that was not ingested. Brand spellings, strengths and company names also differ between sources.', '');

  L.push('## Conflicts and review queue', '',
    `- Conflicts (conflicts.jsonl): ${conflicts.length} ${Object.keys(conflictByField).length ? `(${Object.entries(conflictByField).map(([f, n]) => `${f}: ${n}`).join(', ')})` : ''}`,
    `- Review queue (review_queue.jsonl): ${review.length} ${Object.keys(reviewByType).length ? `(${Object.entries(reviewByType).map(([f, n]) => `${f}: ${n}`).join(', ')})` : ''}`,
    '', '### Resolution rules', '',
    '- Record key: `brand | sorted generic set | strength | dosage form | manufacturer`, all normalized. `#route` is appended only when a source explicitly states a parenteral route (IV/IM/SC), so separately registered IM and IV products are not merged.',
    `- Fuzzy matching runs only within blocks that share the same generic set and dosage-form family. Score = 0.45 × Jaro-Winkler(brand) + 0.25 × strength equality + 0.30 × manufacturer agreement (1 for equal keys; 0.95 when one name's tokens contain the other's; 0.9 when one side is missing; token Jaccard otherwise, which counts as a conflict).`,
    '- A second pass blocks by brand key + form family to catch generic spelling variants ("Levocetirizine" / "Levocetrizine"): ingredients are aligned by Jaro-Winkler; similarity ≥ 0.93 may auto-merge under the same rules, 0.85–0.93 goes to review.',
    `- Auto-merge requires score ≥ ${AUTO_MERGE_THRESHOLD}, equal strength, brand similarity ≥ ${MIN_BRAND_SIMILARITY_FOR_AUTO}, no manufacturer conflict, forms that are equal or where one is the family parent ("Tablet" vs registry "SR Tablet"; the difference is kept in conflicts.jsonl), and a single qualifying candidate. Scores between ${REVIEW_THRESHOLD} and the auto threshold, or several qualifying candidates, go to the review queue and are never merged. Two different DGDA registrations are never merged.`,
    '- Canonical value precedence: DGDA > MedEx > open dataset (Mendeley) > pharmacies. Among pharmacies, the value backed by the most sources wins. Every alternative value is kept in `alternatives` and in conflicts.jsonl.',
    '- Manufacturer merges: names that differ only by legal suffix, punctuation, a site or unit qualifier ("Square Pharmaceuticals PLC, Pabna", "(Dhamrai Unit)", "(Suspended)") or a spelling variant (Pharma = Pharmaceutical(s)) share one key (rule `name_normalization`). The explicit `vocab/manufacturers.yaml` table adds more (rule `alias_table`). Every merge is listed in `manufacturers.jsonl` under `aliases[]`, and raw names including site and status stay in `manufacturer.alternatives`.',
    '- Strength comparison uses a canonical key: mass in mg, mass per volume in mg/ml, mass per mass in % w/w ("3 g/100 g" = "3%", "600 mg/3 ml" = "200 mg/ml"). A slash separates ingredients only when a product has several generics; strengths are paired with their ingredient and sorted, and an unqualified % in liquid presentations is read as w/v (0.5% eye drops = 5 mg/ml).',
    '- Machine-generated Banglish aliases carry `alias_origin: generated`. They are for search only and are never an official name.', '');

  L.push('## Field completeness (canonical products)', '', '| Field | Filled | % |', '|---|---:|---:|');
  for (const f of completenessFields) { const n = meds.filter(m => filled(m, f)).length; L.push(`| ${f} | ${n} | ${pct(n, meds.length)} |`); }
  L.push(`| observed price (any source) | ${medsWithPrice.size} | ${pct(medsWithPrice.size, meds.length)} |`, `| monograph_available | ${meds.filter(m => m.monograph_available).length} | ${pct(meds.filter(m => m.monograph_available).length, meds.length)} |`, '');

  L.push('## Known parser issues and limitations', '');
  const issues: string[] = [];
  for (const s of parseStats.filter(p => p.status !== 'ok')) issues.push(s.status === 'empty' ? `${s.source}: ${s.n} fetched document(s) yielded no medicine facts (non-medicine products such as devices, food or cosmetics, or pages without a parseable title).` : `${s.source}: ${s.n} document(s) parsed with status \`${s.status}\`.`);
  for (const e of parseErrors) issues.push(`Parse failure, ${e.source}: ${e.error.slice(0, 200)}`);
  if (normalizeReport.invalid_count) issues.push(`${normalizeReport.invalid_count} raw facts failed schema validation during normalization.`);
  if (normalizeReport.unmapped_forms.length) issues.push(`${normalizeReport.unmapped_forms.length} distinct dosage-form labels (${normalizeReport.unmapped_forms.reduce((a, u) => a + u.count, 0)} facts) are \`unmapped\`. They are in the review queue; top labels: ${normalizeReport.unmapped_forms.slice(0, 8).map(u => `"${u.raw}" (${u.count})`).join(', ')}.`);
  for (const [file, rows] of Object.entries(validation.invalid)) issues.push(`${file}: ${rows.length} rows were excluded at export for failing schema validation.`);
  issues.push(
    'LazzPharma product and category pages render client-side. Only server-rendered homepage cards and detail-page `<title>` text are parsed, so coverage is limited to homepage products. Its private listing API is deliberately not used.',
    'DGDA registry rows combine generic name and strength in one column. Strength is split at the first number followed by a unit, so ingredients whose names contain numbers followed by units may split incorrectly.',
    'The DGDA registry includes veterinary products (forms `bolus_veterinary`, `water_soluble_powder_veterinary`, `pour_on_veterinary`, and veterinary "Injection"/"Powder" entries from veterinary manufacturers), medical gases and some consumables. They are not filtered out; the import (Stage 3.2) should exclude veterinary forms and manufacturers flagged "(Veterinary)" in `manufacturer.alternatives`.',
    'Manufacturer display names come from the highest-precedence source, so DGDA site qualifiers can appear in the displayed name ("General Pharmaceuticals Ltd, Unit-2"). The matching key ignores them.',
    'Strength display text is kept as the source wrote it (DGDA writes ".5 mg"); use `strength_parsed` for structured values.',
    'Fuzzy merges keep the highest-precedence dosage form, which can be less specific than another source (DGDA "Tablet" vs Mendeley "Chewable Tablet"); the more specific value is in `dosage_form.alternatives`. Manufacturer name containment ("United Pharmaceuticals" within "United Chemicals & Pharmaceuticals") is treated as the same company; such merges are listed in conflicts.jsonl for review.',
    'DGDA per-product price pages are not fetched, so DGDA prices are absent. Prices in this dataset are retail observations or unverified dataset prices.',
    'Generic salt stripping is rule-based: acid and salt forms such as "Valproic Acid" vs "Sodium Valproate" stay distinct generics. `salt_form` keeps the removed qualifier and `aliases` keeps the original text.',
    'The Mendeley dataset does not document how it was collected. Its upstream rights are unverified (LEGAL_REVIEW_REQUIRED). Its gate verdict is UNCLEAR rather than ALLOWED because the dataset landing page returns different content on each fetch, which the gate conservatively treats as changed terms.',
    'Therapeutic class and Bangla brand names are not available from any contributing source in this build.'
  );
  L.push(...issues.map(i => `- ${i}`), '');

  L.push('## Production gates', '', 'This dataset may be imported into production only after **all** of these are complete:', '', ...PRODUCTION_GATES.map((g, i) => `${i + 1}. ${g}`), '',
    'Outstanding for this version:', '',
    `- Legal review required for: ${SOURCES.filter(s => verdicts[s.id]?.legal_review_required && contributed[s.id]).map(s => s.id).join(', ') || 'none'}`,
    `- Permission required before these sources could contribute: ${SOURCES.filter(s => verdicts[s.id]?.verdict === 'PROHIBITED').map(s => s.id).join(', ') || 'none'}`,
    '- Clinician/pharmacist sample review: not started (sample size and error rate to be recorded here)',
    `- DGDA cross-reference: ${meds.some(m => (m.source_ids as string[]).includes('dgda')) ? `run in this build; ${dgda.AMBIGUOUS} AMBIGUOUS and ${reviewByType.fuzzy_match ?? 0} fuzzy review items still need resolving` : 'not completed'}`,
    '- Product import safeguards (catalog-source indicator, free-text fallback, no dosing text): owned by Stage 3.2 and not yet verified', '');
  L.push('## Files', '', '```text', 'medications.jsonl          canonical products with per-field provenance', 'generics.jsonl             generic/active ingredient list with aliases', 'manufacturers.jsonl        manufacturers with logged alias merges', 'aliases.jsonl              bn / banglish / brand-variant aliases with origin', 'prices_observed.jsonl      source, product, price, label, observed_at', 'provenance.jsonl           source records → canonical record links', 'conflicts.jsonl            conflicting field values and the rule applied', 'review_queue.jsonl         fuzzy matches (incl. near DGDA matches), unmapped forms', 'schema/                    JSON Schema for every JSONL file', 'reports/                   normalize/merge/export diagnostics', 'DATASET-CARD.md', 'checksums.sha256', '```', '');

  const card = L.join('\n');
  fs.writeFileSync(path.join(dir, 'DATASET-CARD.md'), card);
  finalizeVersion(dir, version);
  writeSummary(verdicts, contributed);

  // Run log
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const stamp = now.replace(/[:.]/g, '-');
  const R: string[] = [`# Run log ${now}`, '', `- Dataset version: ${version}`, `- Products: ${meds.length}; generics: ${generics.length}; manufacturers: ${manufacturers.length}; aliases: ${aliases.length}; prices: ${prices.length}`, ''];
  if (runNotes.length) R.push('## Notes', '', ...runNotes.map(n => `- ${n}`), '');
  R.push('## Frontier', '', '| Source | Kind | Status | URLs |', '|---|---|---|---:|', ...frontier.map(f => `| ${f.source} | ${f.kind} | ${f.status} | ${f.n} |`), '');
  R.push('## Parse results', '', '| Source | Status | Documents |', '|---|---|---:|', ...parseStats.map(p => `| ${p.source} | ${p.status} | ${p.n} |`), '');
  R.push('## Stop, unblock, cap and fallback events', '', ...(blockedEvents.length ? blockedEvents.map(e => `- ${e.at} ${e.source} ${e.type}: ${e.detail}`) : ['- none']), '');
  R.push('## Resume', '', '```powershell', "$env:CONTACT_EMAIL = '<monitored contact address>'", 'cd tools/medicine-data', 'corepack pnpm md crawl        # continues the SQLite frontier; conditional requests on re-fetch', 'corepack pnpm md parse', 'corepack pnpm md build        # normalize → merge → export → report', '```', '');
  const runLog = path.join(RUNS_DIR, `${stamp}.md`);
  fs.writeFileSync(runLog, R.join('\n'));

  const summary = { version, products: meds.length, generics: generics.length, manufacturers: manufacturers.length, aliases: aliasCounts, prices: prices.length, dgda, nonDgdaMatchRate: pct(nonDgdaMatched, nonDgdaOnly.length), conflicts: conflicts.length, review: review.length, contributed };
  console.log(`[report] ${JSON.stringify(summary)}`);
  return { version, card: path.join(dir, 'DATASET-CARD.md'), runLog, summary };
}
