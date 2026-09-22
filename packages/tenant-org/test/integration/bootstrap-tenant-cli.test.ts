import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { Argon2idHasher } from '@hmedic/identity-access';
import { openTestDatabase, testDatabaseUrl, truncateAll } from '../../../../tests/support/db';

/**
 * `pnpm ops:bootstrap-tenant` (production first-run). The CLI is exercised as a real child process, the way
 * an operator runs it, because the properties that matter are about the process boundary: the password
 * comes from the environment and must never reach stdout or stderr.
 */
const pkg = path.resolve(__dirname, '../..');
const CLI = 'dist/cli/bootstrap-tenant.js';
const PASSWORD = 'correct horse battery staple';

const db = openTestDatabase({ poolMax: 4 });

function run(args: string[], env: Record<string, string | undefined> = {}) {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], {
      cwd: pkg,
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_URL: testDatabaseUrl(),
        HMEDIC_BOOTSTRAP_OWNER_PASSWORD: PASSWORD,
        ARGON2_MEMORY_KIB: '8192',
        ARGON2_TIME_COST: '2',
        ARGON2_PARALLELISM: '1',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out, err: '' };
  } catch (error) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { code: e.status, out: e.stdout ?? '', err: e.stderr ?? '' };
  }
}

beforeEach(async () => {
  await truncateAll();
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-b'], { cwd: pkg });
});

describe('bootstrap-tenant CLI', () => {
  it('creates one tenant with a signed-in-able owner, and never prints the password', async () => {
    const r = run([
      '--name',
      'Demo Clinic',
      '--slug',
      'demo-clinic',
      '--owner-name',
      'Owner Person',
      '--owner-email',
      'owner@example.invalid',
    ]);
    expect(r.code).toBe(0);
    const event = JSON.parse(r.out.trim()) as Record<string, string>;
    expect(event).toMatchObject({ event: 'TENANT_BOOTSTRAPPED', slug: 'demo-clinic', practiceType: 'SOLO' });

    // The whole point of taking the password from the environment: it must not surface anywhere.
    expect(r.out).not.toContain(PASSWORD);
    expect(r.err).not.toContain(PASSWORD);

    const tenant = await db.prisma.tenant.findUniqueOrThrow({ where: { slug: 'demo-clinic' } });
    expect(tenant.status).toBe('ACTIVE');
    expect(tenant.practiceType).toBe('SOLO');
    expect(tenant.ownerDoctorProfileId).toBe(event.ownerDoctorProfileId);

    const user = await db.prisma.user.findUniqueOrThrow({
      where: { emailNormalized: 'owner@example.invalid' },
    });
    expect(user.status).toBe('ACTIVE');
    // The stored hash must verify the supplied password — otherwise the owner cannot actually log in.
    const hasher = new Argon2idHasher({ memoryKiB: 8192, timeCost: 2, parallelism: 1 });
    expect(await hasher.verify(user.passwordHash!, PASSWORD)).toBe(true);
    expect(await hasher.verify(user.passwordHash!, 'wrong password')).toBe(false);

    const membership = await db.prisma.tenantMembership.findFirstOrThrow({
      where: { tenantId: tenant.id, userId: user.id },
    });
    expect(membership.status).toBe('ACTIVE');

    // A bootstrap creates nothing else. One user and one membership, no clinics, and none of the extra
    // staff the seed would add — that difference is the reason this command exists separately from it.
    expect(await db.prisma.clinic.count()).toBe(0);
    expect(await db.prisma.user.count()).toBe(1);
    expect(await db.prisma.tenantMembership.count()).toBe(1);
  });

  it('refuses a second run, and reports rather than duplicates when the slug already exists', async () => {
    const first = run([
      '--name',
      'Demo Clinic',
      '--slug',
      'demo-clinic',
      '--owner-name',
      'Owner Person',
      '--owner-email',
      'owner@example.invalid',
    ]);
    expect(first.code).toBe(0);

    const same = run([
      '--name',
      'Demo Clinic',
      '--slug',
      'demo-clinic',
      '--owner-name',
      'Owner Person',
      '--owner-email',
      'owner@example.invalid',
    ]);
    expect(same.code).toBe(0);
    expect(same.out).toContain('TENANT_ALREADY_BOOTSTRAPPED');

    const other = run([
      '--name',
      'Second Clinic',
      '--slug',
      'second-clinic',
      '--owner-name',
      'Someone Else',
      '--owner-email',
      'other@example.invalid',
    ]);
    expect(other.code).toBe(1);
    expect(other.err).toContain('refusing');
    expect(await db.prisma.tenant.count()).toBe(1);
  });

  it('refuses a missing or too-short password without touching the database', async () => {
    const args = [
      '--name',
      'Demo Clinic',
      '--owner-name',
      'Owner Person',
      '--owner-email',
      'owner@example.invalid',
    ];
    const missing = run(args, { HMEDIC_BOOTSTRAP_OWNER_PASSWORD: undefined });
    expect(missing.code).toBe(2);
    const short = run(args, { HMEDIC_BOOTSTRAP_OWNER_PASSWORD: 'short' });
    expect(short.code).toBe(2);
    expect(short.err).toContain('characters');
    expect(await db.prisma.tenant.count()).toBe(0);
  });
});
