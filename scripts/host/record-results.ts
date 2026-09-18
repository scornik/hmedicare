// `pnpm host:record-results --id HOST-001 --result PASS|FAIL|PARTIAL --evidence "<summary>" [--json probe.json]
//   [--by "<name>"] [--date YYYY-MM-DD]`
//
// Appends (or replaces the same ID + date) a result row in docs/implementation/HOSTING-VERIFICATION.md
// §5.1 "Results". With --json, the probe output is summarized into the evidence cell after redaction
// (tokens, passwords, URLs with credentials and phone numbers are never written). Runs locally; it does not
// call the host.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const DOC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../docs/implementation/HOSTING-VERIFICATION.md',
);
const HEADER = '### 5.1 Results';
const TABLE_HEAD = '| ID | Date | Result | Recorded by | Evidence |\n|---|---|---|---|---|';
const IDS = Array.from({ length: 13 }, (_, i) => `HOST-${String(i + 1).padStart(3, '0')}`);

export function sanitize(text: string): string {
  return text
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/g, '$1[REDACTED]')
    .replace(/(token|password|secret|api[_-]?key)(["'\s:=]+)[^"'\s,}]+/gi, '$1$2[REDACTED]')
    .replace(/\b[a-z]+:\/\/[^\s:@/]+:[^\s@/]+@/gi, '[REDACTED-URL]@')
    .replace(/(?:\+?880|0)1[3-9]\d{8}/g, '[PHONE]')
    .replace(/\|/g, '/')
    .replace(/\r?\n/g, ' ')
    .slice(0, 600);
}

function summarize(json: unknown): string {
  if (!json || typeof json !== 'object') return String(json);
  const flat: string[] = [];
  const walk = (v: unknown, prefix: string) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k, x] of Object.entries(v as Record<string, unknown>))
        walk(x, prefix ? `${prefix}.${k}` : k);
    } else flat.push(`${prefix}=${Array.isArray(v) ? v.join(',') : String(v)}`);
  };
  walk(json, '');
  return flat.join('; ');
}

export function upsertRow(
  doc: string,
  row: { id: string; date: string; result: string; by: string; evidence: string },
): string {
  const line = `| ${row.id} | ${row.date} | ${row.result} | ${sanitize(row.by)} | ${sanitize(row.evidence)} |`;
  if (!doc.includes(HEADER)) {
    const anchor = doc.indexOf('\n## 6');
    const block = `\n${HEADER}\n\nRecorded by \`pnpm host:record-results\` (dated, newest last). DB-dependent tasks stay PROVISIONAL in IMPLEMENTATION-STATUS until HOST-001, HOST-003 and HOST-005 are PASS.\n\n${TABLE_HEAD}\n${line}\n`;
    return anchor >= 0 ? `${doc.slice(0, anchor)}${block}${doc.slice(anchor)}` : `${doc.trimEnd()}\n${block}`;
  }
  const start = doc.indexOf(HEADER);
  const tableStart = doc.indexOf(TABLE_HEAD, start);
  let end = doc.indexOf('\n\n', tableStart + TABLE_HEAD.length);
  if (end < 0) end = doc.length;
  const rows = doc
    .slice(tableStart + TABLE_HEAD.length, end)
    .split('\n')
    .filter((l) => l.startsWith('| ') && !l.startsWith(`| ${row.id} | ${row.date} |`));
  rows.push(line);
  return `${doc.slice(0, tableStart)}${TABLE_HEAD}\n${rows.join('\n')}${doc.slice(end)}`;
}

function main(): void {
  const { values } = parseArgs({
    options: {
      id: { type: 'string' },
      result: { type: 'string' },
      evidence: { type: 'string', default: '' },
      json: { type: 'string' },
      by: { type: 'string', default: 'operator' },
      date: { type: 'string' },
    },
  });
  const id = values.id?.toUpperCase();
  const result = values.result?.toUpperCase();
  if (!id || !IDS.includes(id) || !result || !['PASS', 'FAIL', 'PARTIAL'].includes(result)) {
    process.stderr.write(
      `usage: record-results --id ${IDS[0]}…${IDS[12]} --result PASS|FAIL|PARTIAL --evidence "<text>" [--json file]\n`,
    );
    process.exit(2);
  }
  const probe = values.json ? summarize(JSON.parse(readFileSync(values.json, 'utf8'))) : '';
  const evidence = [values.evidence, probe].filter(Boolean).join(' — ');
  const date = values.date ?? new Date().toISOString().slice(0, 10);
  writeFileSync(DOC, upsertRow(readFileSync(DOC, 'utf8'), { id, date, result, by: values.by!, evidence }));
  process.stdout.write(`recorded ${id} ${result} (${date}) in HOSTING-VERIFICATION.md §5.1\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
