import { describe, expect, it } from 'vitest';
import { LOCKABLE_TABLES, LOCK_RANKING, lockOrderStateOf, recordLock } from '../../src/index';

// Runtime lock-order enforcement (QUEUE-CONCURRENCY-DESIGN §1/§6, audit C-46).
describe('lock ranking', () => {
  it('ranks the documented queue order: chamber day < serials < encounters < chain checkpoint', () => {
    const r = LOCK_RANKING;
    expect(r.chamber_days).toBeLessThan(r.serials!);
    expect(r.serials).toBeLessThan(r.encounters!);
    expect(r.encounters).toBeLessThan(r.integrity_chain_checkpoints!);
    expect(r.patients).toBeLessThan(r.chamber_days!);
    expect(r.appointments).toBeLessThan(r.serials!);
    expect([...LOCKABLE_TABLES].sort()).toEqual(Object.keys(r).sort());
  });

  it('allows non-decreasing ranks (including equal ranks) in one transaction', () => {
    const tx = {};
    recordLock(tx, 'chamber_days');
    recordLock(tx, 'chamber_days');
    recordLock(tx, 'serials');
    recordLock(tx, 'serials');
    recordLock(tx, 'integrity_chain_checkpoints');
    expect(lockOrderStateOf(tx)).toEqual({ highestRank: 80, highestTable: 'integrity_chain_checkpoints' });
  });

  it('rejects every lower-ranked table after a higher-ranked one', () => {
    const tables = Object.entries(LOCK_RANKING).sort((a, b) => a[1] - b[1]);
    let checked = 0;
    for (let i = 0; i < tables.length; i++) {
      for (let j = i + 1; j < tables.length; j++) {
        const [low, lowRank] = tables[i]!;
        const [high, highRank] = tables[j]!;
        if (lowRank === highRank) continue;
        const tx = {};
        recordLock(tx, high);
        expect(() => recordLock(tx, low), `${low} after ${high}`).toThrow(/lock order violation/);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('state is per transaction object and never enumerable', () => {
    const a = {};
    const b = {};
    recordLock(a, 'serials');
    expect(lockOrderStateOf(b)).toBeUndefined();
    expect(Object.keys(a)).toEqual([]);
    expect(() => recordLock(b, 'patients')).not.toThrow();
  });

  it('refuses unranked tables', () => {
    expect(() => recordLock({}, 'not_a_table')).toThrow(/not ranked/);
  });
});
