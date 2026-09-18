import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { DIST_DIR } from '../config.js';
import { MERGE_FILES, WORK_DIR } from '../pipeline/build.js';
import { DATASET_FILES } from '../schemas.js';
import { readJsonl, sha256File, validateRows, writeJsonl } from './jsonl.js';

export interface ExportResult { version: string; dir: string; counts: Record<string, number>; invalid: Record<string, Array<{ index: number; error: string }>> }

export function nextVersion(date = new Date(), dist = DIST_DIR): string {
  const stamp = date.toISOString().slice(0, 10).replace(/-/g, '');
  let n = 1;
  while (fs.existsSync(path.join(dist, `medicine-dataset-${stamp}-${n}`))) n++;
  return `medicine-dataset-${stamp}-${n}`;
}

/** export: validate merged work files against zod schemas and write a versioned dataset directory. */
export function exportStage(): ExportResult {
  const version = nextVersion();
  const dir = path.join(DIST_DIR, version);
  fs.mkdirSync(path.join(dir, 'schema'), { recursive: true });
  const counts: Record<string, number> = {};
  const invalid: Record<string, Array<{ index: number; error: string }>> = {};
  for (const [, file] of MERGE_FILES) {
    const schema = DATASET_FILES[file as keyof typeof DATASET_FILES];
    const rows = readJsonl(path.join(WORK_DIR, 'merged', file));
    const result = validateRows(schema as z.ZodType<unknown>, rows);
    writeJsonl(path.join(dir, file), result.valid);
    counts[file] = result.valid.length;
    if (result.invalid.length) {
      invalid[file] = result.invalid;
      console.warn(`[export] ${file}: ${result.invalid.length} rows failed schema validation and were excluded (first: ${result.invalid[0].error})`);
    }
    fs.writeFileSync(path.join(dir, 'schema', file.replace('.jsonl', '.schema.json')), JSON.stringify(z.toJSONSchema(schema as z.ZodType, { io: 'output', unrepresentable: 'any' }), null, 2));
  }
  fs.mkdirSync(path.join(dir, 'reports'), { recursive: true });
  fs.copyFileSync(path.join(WORK_DIR, 'merged', 'stats.json'), path.join(dir, 'reports', 'merge-stats.json'));
  fs.copyFileSync(path.join(WORK_DIR, 'normalize-report.json'), path.join(dir, 'reports', 'normalize-report.json'));
  fs.writeFileSync(path.join(dir, 'reports', 'export-validation.json'), JSON.stringify({ counts, invalid }, null, 2));
  console.log(`[export] ${version}: ${Object.entries(counts).map(([f, n]) => `${f}=${n}`).join(' ')}`);
  return { version, dir, counts, invalid };
}

/** Writes checksums.sha256 (sha256sum format) for every file in the version directory, and dist/latest.json. */
export function finalizeVersion(dir: string, version: string): void {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const name of fs.readdirSync(d).sort()) {
      const full = path.join(d, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name !== 'checksums.sha256') files.push(full);
    }
  };
  walk(dir);
  const lines = files.map(f => `${sha256File(f)}  ${path.relative(dir, f).split(path.sep).join('/')}`);
  fs.writeFileSync(path.join(dir, 'checksums.sha256'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(DIST_DIR, 'latest.json'), JSON.stringify({
    version,
    path: `./${version}`,
    status: 'UNVERIFIED',
    built_at: new Date().toISOString(),
    card: `./${version}/DATASET-CARD.md`,
    checksums: `./${version}/checksums.sha256`
  }, null, 2) + '\n');
}
