import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { type MedicationRecord, isVeterinary } from '../domain/medication-mapping';
import { DatasetReader } from '../infrastructure/medication-import/dataset-reader';
import {
  DEFAULT_DATASET_PREFIX,
  stagedDatasetDir,
} from '../infrastructure/medication-import/staged-datasets';

/**
 * `pnpm meddata:review --dir <dataset directory> [--sample 10] [--seed <text>] [--out <csv>]`
 * `pnpm meddata:review --dir <dataset directory> --score <marked-up csv>`
 * (ADR-020 §2, the four dataset-card gates).
 *
 * Read-only operator tooling for the production gates. It verifies the dataset, gathers what each gate
 * asks about into one place, draws a reproducible sample for the clinical review, and prints the four
 * `POST /admin/medications/imports` sibling calls that record the attestations.
 *
 * It does not record them. An attestation is a named person stating that a review happened, and a tool
 * that could produce one without the review would make all four worthless — the only reason production
 * can trust the gates is that nothing automatic can satisfy them. So the last step is deliberately a
 * command an operator runs under their own credentials, with a summary they wrote.
 *
 * Neither does it decide. The digest below quotes the dataset card and the dataset's own numbers; it
 * never concludes that a gate passes. Where the card says a review has not been done, that is what
 * prints, however inconvenient.
 */
const GATE_CODES = [
  'LEGAL_SOURCE_REVIEW',
  'CLINICAL_SAMPLE_REVIEW',
  'DGDA_CROSS_REFERENCE',
  'IMPORT_SAFEGUARDS_VERIFIED',
] as const;

const CSV_COLUMNS = [
  'record_id',
  'brand_name',
  'generic_names',
  'strength',
  'dosage_form',
  'route',
  'manufacturer',
  'registration_number',
  'dgda_match',
  'monograph_url',
  'verdict',
  'notes',
] as const;

/** `ok` or `error` per sampled row; anything else is an unreviewed row, which is not an error. */
const VERDICTS = ['ok', 'error'] as const;

/**
 * A seeded PRNG, so a sample can be drawn again and shown to be the same one. A reviewer who signs off
 * on ten records should be able to prove which ten, and `--seed` plus this function is that proof
 * without carrying the sample file around.
 */
function mulberry32(seed: string): () => number {
  const h = createHash('sha256').update(seed).digest();
  let a = h.readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const csvCell = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/** Splits one CSV line, honouring the quoting `csvCell` produces. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cell);
      cell = '';
    } else cell += c;
  }
  out.push(cell);
  return out;
}

/**
 * Reservoir sampling (algorithm R) over the importable records, driven by the seeded PRNG.
 *
 * It streams, because `medications.jsonl` is 45 MB for this version and an operator should be able to
 * run this on the server that holds it. It samples what would actually be imported — veterinary
 * products are excluded here exactly as the importer excludes them — because a pharmacist reviewing
 * rows the catalog will never hold has reviewed nothing.
 */
export async function sampleRecords(
  file: string,
  size: number,
  seed: string,
  excludeVeterinary = true,
): Promise<{ sample: MedicationRecord[]; considered: number; excluded: number }> {
  const rng = mulberry32(seed);
  const reservoir: MedicationRecord[] = [];
  let considered = 0;
  let excluded = 0;

  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const record = JSON.parse(line) as MedicationRecord;
    if (excludeVeterinary && isVeterinary(record)) {
      excluded += 1;
      continue;
    }
    considered += 1;
    if (reservoir.length < size) reservoir.push(record);
    else {
      const j = Math.floor(rng() * considered);
      if (j < size) reservoir[j] = record;
    }
  }
  return { sample: reservoir, considered, excluded };
}

const value = (record: MedicationRecord, key: keyof MedicationRecord): string => {
  const field = record[key] as { value?: unknown } | undefined;
  const raw = field && typeof field === 'object' && 'value' in field ? field.value : field;
  if (raw === null || raw === undefined) return '';
  return Array.isArray(raw) ? raw.map(String).join('; ') : String(raw);
};

function toCsv(sample: MedicationRecord[]): string {
  const rows = sample.map((r) =>
    [
      r.id ?? '',
      value(r, 'brand_name'),
      value(r, 'generic_names'),
      value(r, 'strength'),
      value(r, 'dosage_form'),
      value(r, 'route'),
      value(r, 'manufacturer'),
      value(r, 'registration_number'),
      r.dgda_match ?? '',
      r.monograph_urls?.[0] ?? '',
      '',
      '',
    ]
      .map((c) => csvCell(c))
      .join(','),
  );
  return [CSV_COLUMNS.join(','), ...rows].join('\n') + '\n';
}

export interface ScoreResult {
  rows: number;
  reviewed: number;
  errors: number;
  unreviewed: number;
  invalidVerdicts: string[];
  /** Errors over reviewed rows, to one decimal place; null when nothing was reviewed. */
  errorRatePercent: number | null;
}

/**
 * Counts the verdicts a reviewer wrote into the sample file.
 *
 * The rate is errors over *reviewed* rows, not over the file. A reviewer who marked six of ten rows has
 * a sample size of six, and reporting ten would overstate what was checked in the one record that
 * production decisions are made from.
 */
export function scoreSample(csv: string): ScoreResult {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  const header = splitCsvLine(lines[0] ?? '');
  const verdictAt = header.indexOf('verdict');
  if (verdictAt < 0) throw new Error('the file has no "verdict" column; is it the sample this wrote?');

  let reviewed = 0;
  let errors = 0;
  let unreviewed = 0;
  const invalidVerdicts: string[] = [];
  for (const line of lines.slice(1)) {
    const verdict = (splitCsvLine(line)[verdictAt] ?? '').trim().toLowerCase();
    if (!verdict) {
      unreviewed += 1;
      continue;
    }
    if (!(VERDICTS as readonly string[]).includes(verdict)) {
      invalidVerdicts.push(verdict.slice(0, 40));
      continue;
    }
    reviewed += 1;
    if (verdict === 'error') errors += 1;
  }
  return {
    rows: lines.length - 1,
    reviewed,
    errors,
    unreviewed,
    invalidVerdicts,
    errorRatePercent: reviewed === 0 ? null : Math.round((errors / reviewed) * 1000) / 10,
  };
}

/** The "Outstanding for this version" bullets of the dataset card, quoted rather than interpreted. */
function outstandingFromCard(card: string): string[] {
  const section = card.split(/^## Production gates\s*$/m)[1] ?? '';
  const outstanding = section.split(/^Outstanding for this version:\s*$/m)[1] ?? '';
  return (outstanding.split(/\n\s*\n/)[0] ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim());
}

function printGateDigest(version: string, cardHash: string, card: string, out: (s: string) => void): void {
  const dgda = ((card.split(/^## DGDA cross-reference\s*$/m)[1] ?? '').split(/^## /m)[0] ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- ') || l.startsWith('- **'))
    .slice(0, 3);

  out('');
  out('Dataset-card gates (ADR-020 §2)');
  out(`  evidence base: DATASET-CARD.md@sha256:${cardHash.slice(0, 12)}`);
  out('');
  out('  Outstanding, as the card itself records it:');
  const outstanding = outstandingFromCard(card);
  if (outstanding.length === 0) out('    (the card lists nothing outstanding)');
  for (const bullet of outstanding) out(`    - ${bullet}`);
  if (dgda.length > 0) {
    out('');
    out('  DGDA cross-reference, from the card:');
    for (const line of dgda) out(`    ${line}`);
  }
  out('');
  out(`  Nothing here attests a gate. Each line is what a reviewer of ${version} has to answer.`);
}

function printCommands(
  version: string,
  cardHash: string,
  score: ScoreResult | null,
  samplePath: string | null,
  seed: string,
  out: (s: string) => void,
): void {
  const base = '${API_BASE}/api/v1/admin/medications/gates';
  const evidence: Record<(typeof GATE_CODES)[number], string> = {
    LEGAL_SOURCE_REVIEW: `DATASET-CARD.md#sources-and-compliance@sha256:${cardHash.slice(0, 12)}`,
    CLINICAL_SAMPLE_REVIEW: samplePath
      ? `${path.basename(samplePath)} (seed ${seed})`
      : `clinical sample review of ${version} (seed ${seed})`,
    DGDA_CROSS_REFERENCE: `DATASET-CARD.md#dgda-cross-reference@sha256:${cardHash.slice(0, 12)}`,
    IMPORT_SAFEGUARDS_VERIFIED: 'git tag stage7-cp10-prescriptions',
  };
  const summary: Record<(typeof GATE_CODES)[number], string> = {
    LEGAL_SOURCE_REVIEW: '<which source licences were read, and what they permit>',
    CLINICAL_SAMPLE_REVIEW:
      score && score.errorRatePercent !== null
        ? `reviewed ${score.reviewed} sampled records, ${score.errors} with errors ` +
          `(${score.errorRatePercent}%)`
        : '<sample size and error rate — run with --score to compute them>',
    DGDA_CROSS_REFERENCE: '<what was cross-referenced and what remains unresolved>',
    IMPORT_SAFEGUARDS_VERIFIED:
      '<catalog-source indicator, free-text fallback, no dosing text: how each was checked>',
  };

  out('');
  out('Recording the attestations');
  out('  Four calls, one per gate. Append-only and hash-chained: there is no amend and no delete,');
  out('  so write the summary you are willing to stand behind.');
  out('');
  for (const code of GATE_CODES) {
    out(`  # ${code}`);
    out(`  curl -fsS -X POST ${base} \\`);
    out("    -H 'Content-Type: application/json' \\");
    out("    -H 'X-Platform-Context: operator' \\");
    out('    -H "Authorization: Bearer ${OPERATOR_TOKEN}" \\');
    out(`    -H 'Idempotency-Key: gate-${code.toLowerCase().replace(/_/g, '-')}-${version}' \\`);
    out(
      `    -d '${JSON.stringify({
        datasetVersion: version,
        gateCode: code,
        evidenceRef: evidence[code],
        summary: summary[code],
      })}'`,
    );
    out('');
  }
  out(`  Then: curl -fsS ${base}/${version} -H 'X-Platform-Context: operator' …`);
  out('  and when all four read attested, the import is one more call:');
  out(`  POST \${API_BASE}/api/v1/admin/medications/imports {"datasetVersion":"${version}"}`);
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string' },
      version: { type: 'string' },
      root: { type: 'string' },
      sample: { type: 'string' },
      seed: { type: 'string' },
      out: { type: 'string' },
      score: { type: 'string' },
      'include-veterinary': { type: 'boolean' },
    },
  });

  const cwd = process.env.INIT_CWD ?? process.cwd();
  let dir: string;
  if (values.dir) dir = path.resolve(cwd, values.dir);
  else if (values.version) {
    try {
      dir = stagedDatasetDir(values.version, {
        root: values.root ?? process.env.STORAGE_DISK_ROOT,
        prefix: process.env.MEDICATION_DATASET_STORAGE_PREFIX ?? DEFAULT_DATASET_PREFIX,
      });
    } catch (e) {
      process.stderr.write(`meddata:review: ${String((e as Error).message)}\n`);
      return 2;
    }
  } else {
    process.stderr.write(
      'usage: meddata:review --dir <dataset directory> [--sample <n>] [--seed <text>] [--out <csv>]\n' +
        '       meddata:review --dir <dataset directory> --score <marked-up csv>\n' +
        'Instead of --dir, pass --version <name> to read the staged copy under STORAGE_DISK_ROOT.\n',
    );
    return 2;
  }

  const out = (s: string) => process.stdout.write(`${s}\n`);

  if (values.score) {
    const file = path.resolve(cwd, values.score);
    let score: ScoreResult;
    try {
      score = scoreSample(await readFile(file, 'utf8'));
    } catch (e) {
      process.stderr.write(`meddata:review: ${String((e as Error).message)}\n`);
      return 1;
    }
    out(`Clinical sample review — ${path.basename(file)}`);
    out(`  rows        ${score.rows}`);
    out(`  reviewed    ${score.reviewed}`);
    out(`  errors      ${score.errors}`);
    out(`  unreviewed  ${score.unreviewed}`);
    if (score.invalidVerdicts.length > 0) {
      out(`  unreadable verdicts: ${score.invalidVerdicts.join(', ')} (expected ok or error)`);
    }
    out(
      `  error rate  ${score.errorRatePercent === null ? '— (nothing reviewed)' : `${score.errorRatePercent}%`}`,
    );
    if (score.reviewed === 0) {
      out('');
      out('  Nothing was marked, so there is no sample review to attest to yet.');
      return 1;
    }
    const card = await readFile(path.join(dir, 'DATASET-CARD.md'), 'utf8').catch(() => '');
    const cardHash = createHash('sha256').update(card).digest('hex');
    const version = values.version ?? path.basename(dir);
    printCommands(version, cardHash, score, file, values.seed ?? version, out);
    return 0;
  }

  // Verified before anything is reported. A gate review of a dataset whose bytes do not match its own
  // manifest is a review of something else.
  const version = values.version ?? path.basename(dir);
  const reader = new DatasetReader(dir);
  let preflight;
  try {
    preflight = await reader.preflight(version);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    process.stderr.write(
      `meddata:review: ${err.code ?? 'DATASET_INVALID'}: ${String(err.message ?? e).slice(0, 400)}\n`,
    );
    return 1;
  }

  out(`Dataset ${preflight.version} — ${preflight.datasetStatus}`);
  out(`  directory   ${dir}`);
  out(`  schema set  ${preflight.schemaSet}`);
  out(`  files       ${Object.keys(preflight.fileChecksums).length} verified against checksums.sha256`);
  for (const [file, lines] of Object.entries(preflight.lineCounts)) {
    out(`  ${file.padEnd(24)}${String(lines).padStart(7)} lines`);
  }

  const card = await readFile(path.join(dir, 'DATASET-CARD.md'), 'utf8').catch(() => '');
  const cardHash = createHash('sha256').update(card).digest('hex');
  if (card) printGateDigest(version, cardHash, card, out);

  const size = Number(values.sample ?? 10);
  if (!Number.isInteger(size) || size < 1 || size > 1000) {
    process.stderr.write('meddata:review: --sample must be a whole number between 1 and 1000\n');
    return 2;
  }
  const seed = values.seed ?? version;
  const { sample, considered, excluded } = await sampleRecords(
    path.join(dir, 'medications.jsonl'),
    size,
    seed,
    !values['include-veterinary'],
  );
  const samplePath = path.resolve(cwd, values.out ?? `meddata-review-${version}-sample.csv`);
  await writeFile(samplePath, toCsv(sample), 'utf8');

  out('');
  out('Clinical sample');
  out(`  drawn from  ${considered} importable records (${excluded} veterinary excluded)`);
  out(`  sample      ${sample.length} records, seed "${seed}"`);
  out(`  written to  ${samplePath}`);
  out('  Mark each row\'s "verdict" column ok or error, add notes, then:');
  out(`    pnpm meddata:review --dir ${values.dir ?? dir} --score ${path.basename(samplePath)}`);
  out('  The same seed draws the same records, so the sample can be shown to be the one reviewed.');

  printCommands(version, cardHash, null, samplePath, seed, out);
  return 0;
}

// Only when run as the command. The sampler and the scorer are unit-tested directly, and a module that
// ran `main()` on import would exit the test process instead.
const invokedDirectly = path.basename(process.argv[1] ?? '').startsWith('meddata-review');
if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      process.stderr.write(`meddata:review: ${String((e as Error).stack ?? e)}\n`);
      process.exit(1);
    });
}
