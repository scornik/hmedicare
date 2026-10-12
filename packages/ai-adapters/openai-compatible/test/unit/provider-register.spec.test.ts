import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OPENAI_COMPATIBLE_PROFILES,
  OPENAI_COMPATIBLE_PROVIDER_CODES,
  openAICompatibleMetadata,
} from '../../src/index';

/**
 * OpenAI-compatible metadata against the register (ADAPT-004, AI-PROVIDER-REGISTER.md §2).
 *
 * Five providers share one wire protocol and share nothing else. The protocol says nothing about
 * whether a provider trains on what it receives, and the policy engine reads only the metadata — so
 * this compares every row this adapter claims against the register's table, in both directions. A
 * classification that lives only in code gets changed by whoever is editing the code.
 *
 * The reverse direction matters here more than for a single-provider adapter: a row quietly added to
 * the table without a register entry would be a provider nobody reviewed, reachable by a credential.
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

describe('OpenAI-compatible metadata matches the register', () => {
  const rows = parseRegister();
  const servedRows = rows.filter((row) =>
    (OPENAI_COMPATIBLE_PROVIDER_CODES as readonly string[]).includes(row.providerCode),
  );

  it('finds a register row for every provider this adapter serves', () => {
    const codes = new Set(servedRows.map((row) => row.providerCode));
    for (const code of OPENAI_COMPATIBLE_PROVIDER_CODES) expect(codes).toContain(code);
  });

  it.each(
    OPENAI_COMPATIBLE_PROVIDER_CODES.flatMap((providerCode) =>
      (['FREE', 'PAID'] as const).map((tier) => [providerCode, tier] as const),
    ),
  )('agrees with the register for %s / %s', (providerCode, tier) => {
    const row = rows.find((r) => r.providerCode === providerCode && r.tier === tier);
    const metadata = openAICompatibleMetadata(providerCode, tier);
    if (!row) {
      // A tier the register does not cover must not be claimed. Null is the refusal the credential
      // store acts on; a default would be a classification nobody reviewed.
      expect(metadata, `${providerCode} ${tier} has no register row but metadata exists`).toBeNull();
      return;
    }
    expect(metadata, `${providerCode} ${tier} is in the register but has no metadata`).not.toBeNull();
    expect(metadata!.dataUsePolicy).toBe(row.dataUsePolicy);
    expect(metadata!.productionGate).toBe(row.productionGate);
    expect([...metadata!.usageRestrictions]).toEqual(row.usageRestrictions);
    expect(metadata!.termsUrl).toBe(row.termsUrl);
    expect(metadata!.termsLastVerifiedAt).toBe(row.termsLastVerifiedAt);
  });

  it('does not claim anthropic, whose compatibility layer is not usable', () => {
    // The register carries a row so policy and UI can be built, but its OpenAI-compatibility layer
    // ignores `response_format` and is documented as not production-ready. Metadata for it would make
    // the policy engine permit a credential no adapter can use.
    expect(rows.some((row) => row.providerCode === 'anthropic')).toBe(true);
    expect(openAICompatibleMetadata('anthropic', 'PAID')).toBeNull();
  });

  it('treats an unanswered data-use question as may-train, never as permission', () => {
    // UNKNOWN is what the register records where no-training depends on a setting this platform cannot
    // read, or where the terms were not conclusive. The policy engine reads it as MAY_TRAIN_OR_REVIEW.
    expect(openAICompatibleMetadata('openrouter', 'PAID')?.dataUsePolicy).toBe('UNKNOWN');
    expect(openAICompatibleMetadata('deepseek', 'PAID')?.dataUsePolicy).toBe('UNKNOWN');
  });

  it('claims json_schema only where support was verified', () => {
    // groq's row records JSON_SCHEMA_SUPPORT_UNVERIFIED, so the capability is not claimed and the
    // adapter refuses a schema request instead of sending one hopefully.
    expect(openAICompatibleMetadata('openai', 'PAID')?.capabilities).toContain('json_schema');
    expect(openAICompatibleMetadata('groq', 'FREE')?.capabilities).not.toContain('json_schema');
    expect(openAICompatibleMetadata('groq', 'FREE')?.usageRestrictions).toContain(
      'JSON_SCHEMA_SUPPORT_UNVERIFIED',
    );
  });

  it('leaves every production gate open, with no review record', () => {
    // None of these providers has had a register review, and several have unanswered data-use or
    // processing-region questions (ADR-017 §7).
    for (const providerCode of OPENAI_COMPATIBLE_PROVIDER_CODES) {
      for (const tier of ['FREE', 'PAID'] as const) {
        const metadata = openAICompatibleMetadata(providerCode, tier);
        if (!metadata) continue;
        expect(metadata.productionGate).toBe('OPEN');
        expect(metadata.productionReviewRecordId).toBeUndefined();
      }
    }
  });

  it('records a base URL for every provider it serves', () => {
    for (const providerCode of OPENAI_COMPATIBLE_PROVIDER_CODES) {
      // https only: a base URL over http would send a key in clear text.
      expect(OPENAI_COMPATIBLE_PROFILES[providerCode].baseUrl).toMatch(/^https:\/\//);
    }
  });
});
