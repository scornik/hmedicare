import { describe, expect, it } from 'vitest';
import { autoFlags, combineVerdict, loadReviews } from '../src/compliance/gate.js';
import { SOURCES } from '../src/config.js';
import { ADAPTERS } from '../src/sources/index.js';

const base = { neededPaths: [{ path: '/p/', allowed: true }], unacknowledgedFlags: false, termsChanged: false, termsUnreadable: false };

describe('compliance verdicts', () => {
  it('never relaxes a PROHIBITED review', () => {
    expect(combineVerdict({ ...base, reviewed: 'PROHIBITED' }).verdict).toBe('PROHIBITED');
  });

  it('marks 403/429/challenge during the gate as BLOCKED', () => {
    expect(combineVerdict({ ...base, reviewed: 'ALLOWED', blocked: 'HTTP 403' }).verdict).toBe('BLOCKED');
  });

  it('forces PROHIBITED when unreviewed scraping language appears', () => {
    expect(combineVerdict({ ...base, reviewed: 'UNCLEAR', unacknowledgedFlags: true }).verdict).toBe('PROHIBITED');
  });

  it('turns robots-disallowed needed paths into RESTRICTED', () => {
    expect(combineVerdict({ ...base, reviewed: 'ALLOWED', neededPaths: [{ path: '/a/', allowed: true }, { path: '/b/', allowed: false }] }).verdict).toBe('RESTRICTED');
  });

  it('downgrades ALLOWED to UNCLEAR when terms changed or are unreadable', () => {
    expect(combineVerdict({ ...base, reviewed: 'ALLOWED', termsChanged: true }).verdict).toBe('UNCLEAR');
    expect(combineVerdict({ ...base, reviewed: 'ALLOWED', termsUnreadable: true }).verdict).toBe('UNCLEAR');
  });

  it('keeps auto-scan excerpts under 25 words', () => {
    const text = `${'Filler words to pad this sentence out quite a lot more than needed '.repeat(4)}you must not use bots or crawlers to extract content from this site ever.`;
    const flags = autoFlags(text);
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.every(f => f.replace(' …', '').split(/\s+/).length < 25)).toBe(true);
  });

  it('has a review for every source and no adapter for any PROHIBITED source', () => {
    const reviews = loadReviews();
    for (const s of SOURCES) expect(reviews[s.id], s.id).toBeDefined();
    for (const [id, r] of Object.entries(reviews)) if (r.reviewed_verdict === 'PROHIBITED') expect(ADAPTERS[id], id).toBeUndefined();
  });

  it('keeps reviewed quotes under 25 words', () => {
    for (const r of Object.values(loadReviews())) for (const q of r.quotes ?? []) expect(q.text.split(/\s+/).length, q.text).toBeLessThan(25);
  });
});
