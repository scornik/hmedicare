import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { geminiMetadata } from '../../src/index';

/**
 * Gemini metadata against the register (ADAPT-003, AI-PROVIDER-REGISTER.md §2).
 *
 * The register is the source of truth for how a provider and tier are classified, and it carries the
 * clause evidence behind each value. This parses its table and compares it, for the same reason the
 * mock adapter's copy of this test exists: a data-use classification that lives only in code gets
 * changed by whoever is editing the code, and `MAY_TRAIN_OR_REVIEW` quietly becoming
 * `NO_TRAINING_CONTRACTUAL` would silently drop the tenant opt-in, the acknowledgement and the
 * minimization requirement that depend on it.
 *
 * For Gemini the stakes are concrete. Google's unpaid terms say the content submitted is used "to
 * provide, improve, and develop Google products and services" and that human reviewers may read it.
 */
const REGISTER = path.resolve(__dirname, '../../../../../docs/implementation/AI-PROVIDER-REGISTER.md');

interface RegisterRow {
  providerCode: string;
  tier: string;
  dataUsePolicy: string;
  productionGate: string;
  usageRestrictions: string[];
  termsUrl: string;
  termsLastVerifiedAt: string;
}

function parseRegister(): RegisterRow[] {
  const markdown = readFileSync(REGISTER, 'utf8');
  const section = markdown.split(/^## 2\. Adapter metadata \(normative\)\s*$/m)[1];
  if (!section) throw new Error('AI-PROVIDER-REGISTER.md has no normative §2 table');
  const rows = (section.split(/^## /m)[0] ?? '')
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
    tier: unquote(cells[2]!),
    // Only the leading token is normative; a parenthetical is the reviewer's note.
    dataUsePolicy: unquote(cells[3]!).split(/[\s(]/)[0]!,
    productionGate: unquote(cells[4]!).split(/[\s(]/)[0]!,
    usageRestrictions: unquote(cells[5]!)
      .split(',')
      .map((restriction) => restriction.trim())
      .filter(Boolean),
    termsUrl: unquote(cells[7]!),
    termsLastVerifiedAt: unquote(cells[8]!),
  }));
}

describe('gemini metadata matches the register', () => {
  const rows = parseRegister();

  it.each(['FREE', 'PAID'] as const)('matches the %s tier row', (tier) => {
    const row = rows.find((r) => r.providerCode === 'gemini' && r.tier === tier);
    expect(row, `no gemini ${tier} row in the register`).toBeDefined();
    const metadata = geminiMetadata(tier);

    expect(metadata.dataUsePolicy).toBe(row!.dataUsePolicy);
    expect(metadata.productionGate).toBe(row!.productionGate);
    expect([...metadata.usageRestrictions]).toEqual(row!.usageRestrictions);
    expect(metadata.termsUrl).toBe(row!.termsUrl);
    expect(metadata.termsLastVerifiedAt).toBe(row!.termsLastVerifiedAt);
  });

  it('keeps the unpaid tier on the may-train path', () => {
    // Google's unpaid terms permit use for product improvement and human review, which is what brings
    // the tenant opt-in, the doctor acknowledgement and minimization into force.
    expect(geminiMetadata('FREE').dataUsePolicy).toBe('MAY_TRAIN_OR_REVIEW');
    expect(geminiMetadata('PAID').dataUsePolicy).toBe('NO_TRAINING_CONTRACTUAL');
  });

  it('warns against sensitive personal data on the unpaid tier only', () => {
    // "Do not submit sensitive, confidential, or personal information to the Unpaid Services."
    expect(geminiMetadata('FREE').usageRestrictions).toContain('NO_SENSITIVE_PERSONAL_DATA_FREE_TIER');
    expect(geminiMetadata('PAID').usageRestrictions).not.toContain('NO_SENSITIVE_PERSONAL_DATA_FREE_TIER');
  });

  it('carries the clinical-practice prohibition on both tiers', () => {
    // Google's terms forbid use in clinical practice or to provide medical advice, whichever tier the
    // key is on. It is shown in the credential UI and the acknowledgement text, and it relaxes nothing.
    for (const tier of ['FREE', 'PAID'] as const) {
      expect(geminiMetadata(tier).usageRestrictions).toContain('NO_CLINICAL_PRACTICE_USE');
    }
  });

  it('leaves the production gate open on both tiers, with no review record', () => {
    // Closing it takes a reviewed register change, not a configuration flag, and no review has
    // happened (ADR-017 §7).
    for (const tier of ['FREE', 'PAID'] as const) {
      expect(geminiMetadata(tier).productionGate).toBe('OPEN');
      expect(geminiMetadata(tier).productionReviewRecordId).toBeUndefined();
    }
  });

  it('claims only the capabilities the register lists', () => {
    // No audio: transcription is out of scope for Stage 7, and a capability nobody implemented would
    // let the policy engine permit a call that cannot be made.
    for (const tier of ['FREE', 'PAID'] as const) {
      expect([...geminiMetadata(tier).capabilities]).toEqual(['text', 'json_schema']);
    }
  });
});
