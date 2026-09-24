#!/usr/bin/env node
/**
 * Regenerates the `meddata-mini` fixture datasets.
 *
 *   node packages/prescriptions/test/fixtures/build-meddata-mini.mjs
 *
 * Two tiny dataset directories in the Stage M shape, written from the spec below. Everything in them is
 * invented: the brands, the generics, the manufacturers, the registration numbers and the prices are
 * made up, and the source URLs point at `example.invalid`, a name reserved never to resolve. Nothing
 * here is copied from a real medicine dataset, so the fixture can live in the repository and be read by
 * anyone without a licence question.
 *
 * The five **schemas** are the exception: they are the real Stage M schema files, byte for byte, because
 * the importer pins their SHA-256s (`accepted-schemas.ts`) and a fixture validated against a different
 * contract would prove nothing about the importer that runs in production. They are checked in beside the
 * data and this script only re-hashes them; it does not need the real dataset to run.
 *
 * Why two versions: `-1` is the catalog, and `-2` drops one medication and changes one brand name, which
 * is what makes "a medication deactivated by a later import stays readable" and "an update is reported as
 * an update" testable without hand-editing JSONL.
 *
 * The files are written with LF endings and hashed as written. `.gitattributes` marks this directory
 * binary so git never rewrites a byte and invalidates `checksums.sha256`.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const SOURCE = 'src-mini-1';
const url = (slug) => `https://catalog.example.invalid/${slug}`;

/** `{value, sources, agreement_count}` — the dataset's provenanced field shape. */
const p = (value, agreement = 1) => ({ value, sources: [SOURCE], agreement_count: agreement });

const MANUFACTURERS = [
  { id: 'mf-01', key: 'zenoria-labs', name: 'Zenoria Laboratories Ltd.' },
  { id: 'mf-02', key: 'briskcura-pharma', name: 'Briskcura Pharma PLC' },
  { id: 'mf-03', key: 'zenoria-labs-veterinary', name: 'Zenoria Laboratories Ltd. (Veterinary)' },
];

const GENERICS = [
  { id: 'gn-01', key: 'paracetamoxin', name: 'Paracetamoxin', aliases: ['Paracetamoxine'] },
  { id: 'gn-02', key: 'brivolane', name: 'Brivolane', aliases: [] },
  { id: 'gn-03', key: 'corvexadine', name: 'Corvexadine', aliases: [] },
  { id: 'gn-04', key: 'dolaprexil', name: 'Dolaprexil', aliases: [] },
];

/**
 * `onlyIn` marks the rows that differ between the two versions:
 *   - `md-06` exists only in `-1`, so `-2` deactivates it;
 *   - `md-04`'s brand name differs, so `-2` reports exactly one update.
 */
const MEDICATIONS = [
  {
    id: 'md-01',
    brand: 'Zentaxil 500',
    brandBn: 'জেনটাক্সিল ৫০০',
    generics: ['Paracetamoxin'],
    strength: '500 mg',
    parsed: [{ value: 500, unit: 'mg' }],
    form: 'tablet',
    route: 'oral',
    manufacturer: 'Zenoria Laboratories Ltd.',
    registration: 'MINI-0001',
  },
  {
    id: 'md-02',
    brand: 'Zentaxil 250 Suspension',
    generics: ['Paracetamoxin'],
    strength: '250 mg/5 ml',
    parsed: [{ value: 250, unit: 'mg', per_value: 5, per_unit: 'ml' }],
    form: 'suspension',
    route: 'oral',
    manufacturer: 'Zenoria Laboratories Ltd.',
    registration: 'MINI-0002',
  },
  {
    id: 'md-03',
    brand: 'Brivolan 20',
    generics: ['Brivolane'],
    strength: '20 mg',
    parsed: [{ value: 20, unit: 'mg' }],
    form: 'capsule',
    route: 'oral',
    manufacturer: 'Briskcura Pharma PLC',
    registration: 'MINI-0003',
  },
  {
    // A combination, so the generic-link writer has more than one row to place in order.
    id: 'md-04',
    brand: 'Corvexa Plus',
    brandV2: 'Corvexa Plus DS',
    generics: ['Corvexadine', 'Brivolane'],
    strength: '10 mg + 20 mg',
    parsed: [
      { value: 10, unit: 'mg' },
      { value: 20, unit: 'mg' },
    ],
    form: 'tablet',
    route: 'oral',
    manufacturer: 'Briskcura Pharma PLC',
    registration: 'MINI-0004',
  },
  {
    // Veterinary twice over — by manufacturer marking and by form — so the exclusion is not resting on
    // one field that a future dataset might spell differently.
    id: 'md-05',
    brand: 'Vetrizol 100',
    generics: ['Brivolane'],
    strength: '100 mg/ml',
    parsed: [{ value: 100, unit: 'mg', per_value: 1, per_unit: 'ml' }],
    form: 'bolus_veterinary',
    route: 'oral',
    manufacturer: 'Zenoria Laboratories Ltd. (Veterinary)',
    registration: 'MINI-0005',
  },
  {
    id: 'md-06',
    brand: 'Dolaprex Drops',
    generics: ['Dolaprexil'],
    strength: '5 mg/ml',
    parsed: [{ value: 5, unit: 'mg', per_value: 1, per_unit: 'ml' }],
    form: 'drops',
    route: 'oral',
    manufacturer: 'Zenoria Laboratories Ltd.',
    registration: 'MINI-0006',
    onlyIn: 1,
  },
];

const ALIASES = [
  {
    alias: 'জেনটাক্সিল',
    script: 'bengali',
    kind: 'brand_bn',
    alias_origin: 'source',
    target_type: 'medication',
    target_id: 'md-01',
  },
  {
    alias: 'Jentaxil',
    script: 'latin',
    kind: 'banglish',
    alias_origin: 'generated',
    target_type: 'medication',
    target_id: 'md-01',
  },
  {
    alias: 'Corvexa+',
    script: 'latin',
    kind: 'brand_variant',
    alias_origin: 'source',
    target_type: 'medication',
    target_id: 'md-04',
  },
  {
    alias: 'Paracetamoxine',
    script: 'latin',
    kind: 'generic_variant',
    alias_origin: 'source',
    target_type: 'generic',
    target_id: 'gn-01',
  },
  {
    // Points at the veterinary product, which the default import excludes. It must land in
    // `rejectedUnresolvedTarget` rather than fail the run: an alias whose target was never written is
    // meaningless, and dropping it silently would hide how much of the alias file the exclusion takes.
    alias: 'Vetrizol Inj',
    script: 'latin',
    kind: 'brand_variant',
    alias_origin: 'source',
    target_type: 'medication',
    target_id: 'md-05',
  },
];

const PRICES = [
  { medication_id: 'md-01', unit_price_bdt: 1.2, is_official_mrp: true, price_label: 'MRP per tablet' },
  { medication_id: 'md-02', pack_price_bdt: 35, is_official_mrp: true, price_label: 'MRP per bottle' },
  { medication_id: 'md-03', unit_price_bdt: 8.75, is_official_mrp: false },
  {
    // Three decimal places, which `DECIMAL(12,2)` cannot hold. Rounding would invent a price nobody
    // published, so this one must be counted as rejected and not written.
    medication_id: 'md-04',
    unit_price_bdt: 12.345,
    is_official_mrp: false,
  },
];

function medication(spec, version) {
  const brand = version === 2 && spec.brandV2 ? spec.brandV2 : spec.brand;
  const record = {
    id: spec.id,
    record_key: `${spec.id}|${spec.registration}`,
    brand_name: p(brand),
    generic_names: p(spec.generics),
    salt_forms: [],
    strength: p(spec.strength),
    strength_parsed: spec.parsed,
    dosage_form: p(spec.form),
    dosage_form_raw: [spec.form],
    route: p(spec.route),
    manufacturer: p(spec.manufacturer),
    registration_number: p(spec.registration),
    monograph_available: false,
    monograph_urls: [],
    dgda_match: 'NOT_CHECKED',
    source_ids: [SOURCE],
    source_record_count: 1,
    status: 'UNVERIFIED',
  };
  if (spec.brandBn) record.brand_name_bn = p(spec.brandBn);
  return record;
}

const jsonl = (records) => records.map((r) => JSON.stringify(r)).join('\n') + '\n';

async function build(version) {
  const name = `meddata-mini-20260924-${version}`;
  const dir = path.join(here, name);
  await mkdir(path.join(dir, 'schema'), { recursive: true });

  const files = {
    'manufacturers.jsonl': jsonl(
      MANUFACTURERS.map((m) => ({
        id: m.id,
        key: m.key,
        name: m.name,
        aliases: [{ raw: m.name, rule: 'verbatim', sources: [SOURCE] }],
        product_count: MEDICATIONS.filter((x) => x.manufacturer === m.name).length,
        source_ids: [SOURCE],
      })),
    ),
    'generics.jsonl': jsonl(
      GENERICS.map((g) => ({
        id: g.id,
        key: g.key,
        name: g.name,
        aliases: g.aliases,
        salt_forms: [],
        product_count: MEDICATIONS.filter((x) => x.generics.includes(g.name)).length,
        source_ids: [SOURCE],
      })),
    ),
    'medications.jsonl': jsonl(
      MEDICATIONS.filter((m) => m.onlyIn === undefined || m.onlyIn === version).map((m) =>
        medication(m, version),
      ),
    ),
    'aliases.jsonl': jsonl(ALIASES.map((a) => ({ ...a, sources: [SOURCE] }))),
    'prices_observed.jsonl': jsonl(
      PRICES.map((x) => ({
        ...x,
        record_key: `${x.medication_id}|price`,
        source_id: SOURCE,
        source_url: url(x.medication_id),
        observed_at: '2026-09-24T00:00:00Z',
      })),
    ),
  };

  for (const [file, body] of Object.entries(files)) {
    await writeFile(path.join(dir, file), body, 'utf8');
  }

  // The schemas already sit in `schema/`; they are hashed where they are, never rewritten.
  const schemas = (await readdir(path.join(dir, 'schema'))).sort();
  if (schemas.length === 0) {
    throw new Error(`${name}/schema is empty: copy the five Stage M schema files in before building`);
  }

  const lines = [];
  for (const file of [...Object.keys(files).sort(), ...schemas.map((s) => `schema/${s}`)]) {
    const bytes = await readFile(path.join(dir, file));
    lines.push(`${createHash('sha256').update(bytes).digest('hex')}  ${file}`);
  }
  await writeFile(path.join(dir, 'checksums.sha256'), lines.join('\n') + '\n', 'utf8');
  process.stdout.write(`${name}: ${lines.length} files\n`);
}

await build(1);
await build(2);
