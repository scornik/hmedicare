import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mockMetadata } from '../../src/index';

/**
 * Adapter metadata against the register (ADAPT-001, AI-PROVIDER-REGISTER.md §2).
 *
 * The register is the source of truth for how a provider and tier are classified, and this parses its
 * table and compares it with what the adapter reports. The reason the comparison exists at all: a
 * data-use classification that lives only in code gets changed by whoever is editing the code, and
 * `MAY_TRAIN_OR_REVIEW` quietly becoming `NO_TRAINING_CONTRACTUAL` would silently drop the tenant
 * opt-in, the acknowledgement and the minimization requirement that depend on it.
 *
 * Only the `mock` rows are asserted here, because only the mock adapter exists. Each further adapter
 * brings its own metadata and extends this comparison (ADAPT-003, ADAPT-004).
 */
const REGISTER = path.resolve(__dirname, '../../../../../docs/implementation/AI-PROVIDER-REGISTER.md');

interface RegisterRow {
  providerCode: string;
  adapter: string;
  tier: string;
  dataUsePolicy: string;
  productionGate: string;
  usageRestrictions: string[];
  termsUrl: string;
  termsLastVerifiedAt: string;
}

/**
 * Parses §2's table.
 *
 * Deliberately strict about the section: a register that stopped having a §2 table, or renamed it,
 * should fail loudly here rather than silently assert nothing — a comparison that passes over an empty
 * list is the failure mode this test is meant to prevent.
 */
function parseRegister(): RegisterRow[] {
  const markdown = readFileSync(REGISTER, 'utf8');
  const section = markdown.split(/^## 2\. Adapter metadata \(normative\)\s*$/m)[1];
  if (!section) throw new Error('AI-PROVIDER-REGISTER.md has no normative §2 table');
  const body = section.split(/^## /m)[0] ?? '';
  const rows = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && line.includes('`'))
    .map((line) =>
      line
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim()),
    )
    .filter((cells) => cells.length >= 9);
  if (rows.length === 0) throw new Error('AI-PROVIDER-REGISTER.md §2 parsed to no rows');

  const unquote = (cell: string) => cell.replace(/`/g, '').trim();
  return rows.map((cells) => ({
    providerCode: unquote(cells[0]!),
    adapter: unquote(cells[1]!),
    tier: unquote(cells[2]!),
    // The register annotates classifications in prose, e.g. "MAY_TRAIN_OR_REVIEW (synthetic, …)".
    // Only the leading token is normative; the parenthetical is the reviewer's note.
    dataUsePolicy: unquote(cells[3]!).split(/[\s(]/)[0]!,
    productionGate: unquote(cells[4]!).split(/[\s(]/)[0]!,
    usageRestrictions: unquote(cells[5]!)
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean),
    termsUrl: unquote(cells[7]!),
    termsLastVerifiedAt: unquote(cells[8]!),
  }));
}

describe('AI provider register §2', () => {
  const rows = parseRegister();

  it('parses every provider row', () => {
    // A sanity floor: the register lists several providers whose adapters are still to come, and a
    // parser that silently matched only `mock` would hide a table format change.
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(new Set(rows.map((r) => r.providerCode))).toContain('mock');
  });

  it.each(['FREE', 'PAID'] as const)('matches the mock adapter for the %s tier', (tier) => {
    const row = rows.find((r) => r.providerCode === 'mock' && r.tier === tier);
    expect(row, `no mock ${tier} row in the register`).toBeDefined();
    const metadata = mockMetadata(tier);

    expect(metadata.dataUsePolicy).toBe(row!.dataUsePolicy);
    expect(metadata.productionGate).toBe(row!.productionGate);
    expect([...metadata.usageRestrictions]).toEqual(row!.usageRestrictions);
    expect(metadata.termsUrl).toBe(row!.termsUrl);
    expect(metadata.termsLastVerifiedAt).toBe(row!.termsLastVerifiedAt);
  });

  it('keeps the two mock tiers on different data-use paths', () => {
    // The point of having both: FREE exercises the may-train path with its opt-in, acknowledgement and
    // minimization requirements, PAID exercises the contractual-no-training path. One tier alone would
    // leave the stricter path untested.
    expect(mockMetadata('FREE').dataUsePolicy).toBe('MAY_TRAIN_OR_REVIEW');
    expect(mockMetadata('PAID').dataUsePolicy).toBe('NO_TRAINING_CONTRACTUAL');
  });

  it('never closes the mock production gate', () => {
    // A mock credential active in production would be a model that answers nothing pretending to be
    // one that answers something.
    for (const tier of ['FREE', 'PAID'] as const) {
      expect(mockMetadata(tier).productionGate).toBe('OPEN');
      expect(mockMetadata(tier).productionReviewRecordId).toBeUndefined();
    }
  });

  it('marks the mock as synthetic-only, which the policy engine reads', () => {
    for (const tier of ['FREE', 'PAID'] as const) {
      expect(mockMetadata(tier).usageRestrictions).toContain('SYNTHETIC_DATA_ONLY');
    }
  });
});
