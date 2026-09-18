import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError, newId } from '@hmedic/kernel';
import { type Database, withTransaction } from '@hmedic/database';
import {
  type AuditEntry,
  PrismaAuditPort,
  PrismaAuditReader,
  VerifyAppendOnlyChains,
} from '../../src/public/index';
import { openTestDatabase, rawConnection, testDatabaseUrl, truncateAll } from '../../../../tests/support/db';

// FOUND-012: hash-chained audit, verification and tamper detection (T15). Runs on mariadb:10.6 and 11.4.
let db: Database;
const port = new PrismaAuditPort();

beforeAll(() => {
  db = openTestDatabase({ poolMax: 12 });
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await truncateAll();
});

function entry(tenantId: string | null, n = 0): AuditEntry {
  return {
    tenantId,
    actorUserId: null,
    actorType: 'SYSTEM',
    action: 'PROBE_RECORDED',
    resourceType: 'probe',
    resourceId: newId(),
    outcome: 'SUCCESS',
    correlationId: newId(),
    metadata: { n, tags: ['a', 'b'] },
  };
}

async function append(tenantId: string | null, n = 0) {
  return withTransaction(db.prisma, (tx) => port.append(tx, entry(tenantId, n)));
}

async function tenant(): Promise<string> {
  const id = newId();
  const now = new Date();
  await db.prisma.tenant.create({
    data: {
      id,
      name: 'DEMO audit',
      slug: `demo-audit-${id.slice(-8)}`,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  return id;
}

describe('AuditPort + ChainAppender', () => {
  it('allocates gap-free sequences under concurrency and the chain verifies', async () => {
    const t = await tenant();
    await Promise.all(Array.from({ length: 20 }, (_, i) => append(t, i)));
    const rows = await db.prisma.auditLog.findMany({ where: { tenantId: t }, orderBy: { seq: 'asc' } });
    expect(rows.map((r) => Number(r.seq))).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(rows[0]!.prevRowHash).toBeNull();
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.prevRowHash).toBe(rows[i - 1]!.rowHash);
    const [result] = await new VerifyAppendOnlyChains(db.prisma).run();
    expect(result).toMatchObject({ checkpointKey: `audit:tenant:${t}`, ok: true, rows: 20 });
  });

  it('keeps separate chains per tenant and for the platform', async () => {
    const [a, b] = [await tenant(), await tenant()];
    await append(a);
    await append(b);
    await append(null);
    await append(a);
    const cps = await db.prisma.integrityChainCheckpoint.findMany({ orderBy: { chainKey: 'asc' } });
    expect(cps.map((c) => [c.chainKey, Number(c.lastSeq)])).toEqual(
      [
        ['audit:platform', 1],
        [`audit:tenant:${a}`, 2],
        [`audit:tenant:${b}`, 1],
      ].sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    );
  });

  it('writes the audit row only if the audited change commits', async () => {
    const t = await tenant();
    await append(t);
    await expect(
      withTransaction(db.prisma, async (tx) => {
        await port.append(tx, entry(t));
        throw new AppError('STALE_VERSION');
      }),
    ).rejects.toThrow();
    expect(await db.prisma.auditLog.count({ where: { tenantId: t } })).toBe(1);
    const cp = await db.prisma.integrityChainCheckpoint.findUniqueOrThrow({
      where: { chainKey: `audit:tenant:${t}` },
    });
    expect(Number(cp.lastSeq)).toBe(1);
    await append(t);
    expect((await new VerifyAppendOnlyChains(db.prisma).run())[0]!.ok).toBe(true);
  });

  it('verifies incrementally from verified_through_seq', async () => {
    const verifier = new VerifyAppendOnlyChains(db.prisma);
    await append(null);
    await append(null);
    expect((await verifier.run())[0]).toMatchObject({ ok: true, rows: 2 });
    await append(null);
    expect((await verifier.run())[0]).toMatchObject({ ok: true, verifiedFrom: 2n, rows: 1 });
  });
});

describe('Tamper detection (T15)', () => {
  async function seed(n: number) {
    const t = await tenant();
    for (let i = 0; i < n; i++) await append(t, i);
    return t;
  }

  async function sql(statement: string, ...params: unknown[]) {
    const conn = await rawConnection();
    try {
      await conn.query(statement, params);
    } finally {
      await conn.end();
    }
  }

  it('detects a direct SQL update of a row and records INTEGRITY_CHAIN_BROKEN on the platform chain', async () => {
    const t = await seed(5);
    await sql(`UPDATE audit_logs SET outcome = 'DENIED' WHERE tenant_id = ? AND seq = 3`, t);
    const results = await new VerifyAppendOnlyChains(db.prisma).run({ full: true });
    const broken = results.find((r) => r.checkpointKey === `audit:tenant:${t}`)!;
    expect(broken.ok).toBe(false);
    expect(broken.break).toMatchObject({ seq: 3n, reason: 'HASH_MISMATCH' });
    const event = await db.prisma.auditLog.findFirstOrThrow({ where: { action: 'INTEGRITY_CHAIN_BROKEN' } });
    expect(event).toMatchObject({ tenantId: null, chainKey: 'platform', outcome: 'FAILED' });
    expect(event.metadata).toMatchObject({
      chainKey: `audit:tenant:${t}`,
      seq: '3',
      reason: 'HASH_MISMATCH',
    });
    // A broken chain is never marked verified.
    const cp = await db.prisma.integrityChainCheckpoint.findUniqueOrThrow({
      where: { chainKey: `audit:tenant:${t}` },
    });
    expect(Number(cp.verifiedThroughSeq)).toBe(0);
  });

  it('detects an overwritten row_hash', async () => {
    const t = await seed(4);
    await sql(`UPDATE audit_logs SET row_hash = ? WHERE tenant_id = ? AND seq = 2`, 'f'.repeat(64), t);
    const [r] = await new VerifyAppendOnlyChains(db.prisma).run({
      full: true,
      checkpointKey: `audit:tenant:${t}`,
    });
    expect(r!.break).toMatchObject({ seq: 2n, reason: 'HASH_MISMATCH' });
  });

  it('detects a deleted row (gap) and a truncated tail', async () => {
    const t = await seed(4);
    await sql('DELETE FROM audit_logs WHERE tenant_id = ? AND seq = 2', t);
    const [gap] = await new VerifyAppendOnlyChains(db.prisma).run({
      full: true,
      checkpointKey: `audit:tenant:${t}`,
    });
    expect(gap!.break).toMatchObject({ seq: 2n, reason: 'SEQ_GAP' });
    const t2 = await seed(3);
    await sql('DELETE FROM audit_logs WHERE tenant_id = ? AND seq = 3', t2);
    const [tail] = await new VerifyAppendOnlyChains(db.prisma).run({
      full: true,
      checkpointKey: `audit:tenant:${t2}`,
    });
    expect(tail!.break).toMatchObject({ seq: 3n, reason: 'SEQ_GAP' });
  });

  it(
    'verify-audit-chain CLI exits 0 on intact chains and 2 after tampering',
    { timeout: 180_000 },
    async () => {
      {
        const t = await seed(2);
        const pkg = path.resolve(__dirname, '../..');
        // Exercise the shipped entry point (compiled), exactly as `pnpm verify-audit-chain` runs it.
        execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-b'], { cwd: pkg });
        const run = () => {
          try {
            const out = execFileSync(process.execPath, ['dist/cli/verify-audit-chain.js', '--full'], {
              cwd: pkg,
              env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
              encoding: 'utf8',
            });
            return { code: 0, out };
          } catch (error) {
            const e = error as { status: number; stdout: string };
            return { code: e.status, out: e.stdout };
          }
        };
        const ok = run();
        expect(ok.code).toBe(0);
        expect(ok.out).toContain('"broken":0');
        await sql(`UPDATE audit_logs SET action = 'PROBE_EDITED' WHERE tenant_id = ? AND seq = 1`, t);
        const bad = run();
        expect(bad.code).toBe(2);
        expect(bad.out).toContain('"reason":"HASH_MISMATCH"');
        expect(bad.out).not.toContain('PROBE_EDITED');
      }
    },
  );
});

describe('Append-only repositories (DATABASE-IMPLEMENTATION §4.3)', () => {
  it('audit port and reader expose no mutating method', () => {
    const methods = (o: object) => Object.getOwnPropertyNames(Object.getPrototypeOf(o));
    for (const m of [...methods(port), ...methods(new PrismaAuditReader(db.prisma))]) {
      expect(m).not.toMatch(/update|delete|upsert|remove|truncate|set/i);
    }
  });

  it('reader returns tenant-scoped rows only', async () => {
    const [a, b] = [await tenant(), await tenant()];
    const e = entry(a);
    await withTransaction(db.prisma, (tx) => port.append(tx, e));
    await withTransaction(db.prisma, (tx) => port.append(tx, { ...entry(b), resourceId: e.resourceId }));
    const reader = new PrismaAuditReader(db.prisma);
    const rows = await reader.listForResource(a, 'probe', e.resourceId!);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tenantId).toBe(a);
  });
});
