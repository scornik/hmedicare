import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '@hmedic/kernel';
import type { Database } from '@hmedic/database';
import { PrismaAuditPort, VerifyAppendOnlyChains, auditChainSource } from '@hmedic/audit';
import { GateDecisionReader, GateDecisionRecorder, gateChainSource } from '../../src/index';
import { openTestDatabase, rawConnection, testDatabaseUrl, truncateAll } from '../../../../tests/support/db';

// SMS-001 gate decisions (ADR-018 §2): expiry, revocation, 60 s cache, hash chain, CLI.
let db: Database;
const clock = new FixedClock(new Date('2026-09-18T06:00:00.000Z'));
let recorder: GateDecisionRecorder;
const DAY = 86_400_000;

beforeAll(() => {
  db = openTestDatabase();
  recorder = new GateDecisionRecorder(db.prisma, new PrismaAuditPort(clock), clock);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await truncateAll();
  await (async () => {
    const c = await rawConnection();
    try {
      await c.query('DELETE FROM platform_gate_decisions');
      await c.query("DELETE FROM integrity_chain_checkpoints WHERE chain_key = 'gate:platform'");
    } finally {
      await c.end();
    }
  })();
  clock.set(new Date('2026-09-18T06:00:00.000Z'));
});

const accept = (days: number, environment: 'staging' | 'production' = 'production') =>
  recorder.record({
    gateCode: 'GATE-SMS-HTTP',
    environment,
    decision: 'ACCEPTED',
    ownerName: 'Demo Owner',
    evidenceRef: 'DOC-DEMO-1',
    decidedBy: 'cli:test',
    expiresAt: new Date(clock.now().getTime() + days * DAY),
  });

describe('GateDecisionRecorder / Reader', () => {
  it('is open by default, closed by an unexpired ACCEPTED decision, open again after expiry', async () => {
    const reader = new GateDecisionReader(db.prisma, clock, 0);
    expect(await reader.isClosed('GATE-SMS-HTTP', 'production')).toBe(false);
    await accept(30);
    expect(await reader.isClosed('GATE-SMS-HTTP', 'production')).toBe(true);
    expect(await reader.isClosed('GATE-SMS-HTTP', 'staging')).toBe(false);
    clock.advanceMs(31 * DAY);
    expect(await reader.isClosed('GATE-SMS-HTTP', 'production')).toBe(false);
  });

  it('REVOKED re-opens the gate; readers cache for at most 60 s', async () => {
    const reader = new GateDecisionReader(db.prisma, clock);
    await accept(30);
    expect(await reader.isClosed('GATE-SMS-HTTP', 'production')).toBe(true);
    await recorder.record({
      gateCode: 'GATE-SMS-HTTP',
      environment: 'production',
      decision: 'REVOKED',
      ownerName: 'Demo Owner',
      evidenceRef: 'DOC-DEMO-2',
      decidedBy: 'cli:test',
    });
    expect(await reader.isClosed('GATE-SMS-HTTP', 'production')).toBe(true); // cached
    clock.advanceMs(61_000);
    expect(await reader.isClosed('GATE-SMS-HTTP', 'production')).toBe(false);
  });

  it('refuses ACCEPTED without a future expiry', async () => {
    await expect(accept(0)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(accept(-1)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('chains decisions (gate:platform), verifies, and detects tampering; audits each decision', async () => {
    await accept(30);
    await accept(60, 'staging');
    const verifier = new VerifyAppendOnlyChains(db.prisma, [auditChainSource, gateChainSource]);
    expect((await verifier.run({ full: true })).every((r) => r.ok)).toBe(true);
    expect(await db.prisma.auditLog.count({ where: { action: 'GATE_DECISION_RECORDED' } })).toBe(2);
    const c = await rawConnection();
    try {
      await c.query("UPDATE platform_gate_decisions SET expires_at = '2099-01-01' WHERE seq = 1");
    } finally {
      await c.end();
    }
    const results = await verifier.run({ full: true, checkpointKey: 'gate:platform' });
    expect(results[0]).toMatchObject({ ok: false, break: { reason: 'HASH_MISMATCH' } });
  });

  it('record-risk-decision CLI (no HTTP route exists)', { timeout: 180_000 }, async () => {
    const pkg = path.resolve(__dirname, '../..');
    execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-b'], { cwd: pkg });
    const out = execFileSync(
      process.execPath,
      [
        'dist/cli/record-risk-decision.js',
        '--gate',
        'GATE-SMS-HTTP',
        '--environment',
        'staging',
        '--decision',
        'ACCEPTED',
        '--owner',
        'Demo Owner',
        '--evidence',
        'DOC-DEMO-3',
        '--expires',
        '2099-12-31',
      ],
      { cwd: pkg, env: { ...process.env, DATABASE_URL: testDatabaseUrl() }, encoding: 'utf8' },
    );
    expect(out).toContain('GATE_DECISION_RECORDED');
    expect(await new GateDecisionReader(db.prisma).isClosed('GATE-SMS-HTTP', 'staging')).toBe(true);
  });
});
