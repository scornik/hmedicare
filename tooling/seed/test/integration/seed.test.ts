import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateSecret } from '@hmedic/config/testing';
import type { Database } from '@hmedic/database';
import { Seeder, verifySeed } from '../../src/seed';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';

// Seed: idempotent, synthetic-only, verified; passwords only for new/rotated users (SEED-DATA §1).
let db: Database;
const cfg = {
  appEnv: 'test',
  argon2: { memoryKiB: 8192, timeCost: 1, parallelism: 1 },
  kek: { id: 'test-pc-1', base64: randomBytes(32).toString('base64') },
  fingerprintPepper: generateSecret(),
};

beforeAll(() => {
  db = openTestDatabase();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await truncateAll();
});

describe('seed', () => {
  it('creates the Stage 4 dataset once, verifies, and is idempotent', async () => {
    const first = await new Seeder(db.prisma, cfg, { rotatePasswords: false }).run();
    expect(first.created.length).toBeGreaterThan(10);
    expect(first.credentials.map((c) => c.role).sort()).toEqual(
      [
        'billing_manager',
        'clinic_admin',
        'doctor',
        'doctor',
        'doctor (solo owner)',
        'nurse',
        'platform operator',
        'receptionist',
        'tenant_owner',
      ].sort(),
    );
    expect(await verifySeed(db.prisma)).toEqual([]);
    const second = await new Seeder(db.prisma, cfg, { rotatePasswords: false }).run();
    expect(second).toEqual({ created: [], credentials: [] });
    const rotated = await new Seeder(db.prisma, cfg, { rotatePasswords: true }).run();
    expect(rotated.created).toEqual([]);
    expect(rotated.credentials).toHaveLength(9);
    expect(await verifySeed(db.prisma)).toEqual([]);
  });

  it('stores no plaintext SMS key and never seeds outside the synthetic ranges', async () => {
    await new Seeder(db.prisma, cfg, { rotatePasswords: false }).run();
    const creds = await db.prisma.providerCredential.findMany();
    expect(creds.map((c) => c.status).sort()).toEqual(['ACTIVE', 'SUSPENDED_BALANCE']);
    expect(JSON.stringify(creds)).not.toMatch(/fake_mock_[0-9a-f]{32}/);
    expect(await db.prisma.smsBalanceSnapshot.count({ where: { parseStatus: 'UNPARSED' } })).toBe(1);
    const users = await db.prisma.user.findMany();
    expect(users.every((u) => !u.emailNormalized || u.emailNormalized.endsWith('@example.invalid'))).toBe(
      true,
    );
    expect(users.every((u) => !u.phoneE164 || /^\+8801700000\d{3}$/.test(u.phoneE164))).toBe(true);
  });

  it('refuses production', async () => {
    await expect(
      new Seeder(db.prisma, { ...cfg, appEnv: 'production' }, { rotatePasswords: false }).run(),
    ).rejects.toThrow(/refuses/);
  });
});
