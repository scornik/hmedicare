import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ZodType } from 'zod';

export function writeJsonl(file: string, rows: unknown[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // UTF-8 without BOM, one JSON object per line, LF endings; Bangla is written as-is (not \u-escaped).
  fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
}

export function readJsonl<T = unknown>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as T);
}

export function validateRows<T>(schema: ZodType<T>, rows: unknown[]): { valid: T[]; invalid: Array<{ index: number; error: string }> } {
  const valid: T[] = [];
  const invalid: Array<{ index: number; error: string }> = [];
  rows.forEach((row, index) => {
    const result = schema.safeParse(row);
    if (result.success) valid.push(result.data);
    else invalid.push({ index, error: result.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`).join('; ') });
  });
  return { valid, invalid };
}

export function sha256File(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
