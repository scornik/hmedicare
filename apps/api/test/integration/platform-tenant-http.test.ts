import { execFileSync } from 'node:child_process';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type ServerConfig, loadConfig } from '@hmedic/config';
import { testEnv } from '@hmedic/config/testing';
import { newId } from '@hmedic/kernel';
import { Argon2idHasher, PlatformOperatorService } from '@hmedic/identity-access';
import { TenantBootstrapService } from '@hmedic/tenant-org';
import { type ApiInstance, buildApi } from '../../src/compose';
import { testDatabaseUrl, truncateAll } from '../../../../tests/support/db';

// ID-007 platform operators (T31) and ID-006 membership/coverage HTTP.
const PASSWORD = 'correct horse battery';
let api: ApiInstance;
let server: Parameters<typeof request>[0];
let seq = 0;
const idem = () => `pt-key-${Date.now()}-${++seq}`;
const hasher = new Argon2idHasher({ memoryKiB: 8192, timeCost: 1, parallelism: 1 });

beforeAll(async () => {
  api = await buildApi(loadConfig<ServerConfig>('api', testEnv({ DATABASE_URL: testDatabaseUrl() })));
  server = api.app.getHttpServer();
});
afterAll(async () => {
  await api?.close();
});
beforeEach(async () => {
  await truncateAll();
});

async function user(opts: { phone?: string } = {}) {
  const now = new Date();
  const id = newId();
  const email = `u.${id.slice(-10)}@example.invalid`;
  await api.runtime.prisma.user.create({
    data: {
      id,
      email,
      emailNormalized: email,
      phoneE164: opts.phone ?? null,
      phoneVerifiedAt: opts.phone ? now : null,
      status: 'ACTIVE',
      passwordHash: await hasher.hash(PASSWORD),
      createdAt: now,
      updatedAt: now,
    },
  });
  return { id, email };
}

async function login(email: string) {
  const r = await request(server)
    .post('/api/v1/auth/password/login')
    .set('idempotency-key', idem())
    .send({ email, password: PASSWORD, client: 'android' })
    .expect(200);
  return { authorization: `Bearer ${r.body.data.accessToken}` };
}

async function stepUp(auth: Record<string, string>) {
  const r = await request(server)
    .post('/api/v1/auth/step-up/otp/request')
    .set(auth)
    .set('idempotency-key', idem())
    .send({})
    .expect(202);
  const code = (await request(server).get(`/internal/test/otp/${r.body.data.challengeId}`).expect(200)).body
    .code;
  return request(server)
    .post('/api/v1/auth/step-up/otp/verify')
    .set(auth)
    .set('idempotency-key', idem())
    .send({ code });
}

const operators = () => new PlatformOperatorService(api.runtime.prisma, api.runtime.audit, api.runtime.clock);
const newTenant = (
  auth: Record<string, string>,
  extra: Record<string, string> = { 'x-platform-context': 'operator' },
) =>
  request(server)
    .post('/api/v1/tenants')
    .set(auth)
    .set(extra)
    .set('idempotency-key', idem())
    .send({
      name: 'DEMO Group Clinic',
      practiceType: 'GROUP',
      owner: { email: `owner.${newId().slice(-8)}@example.invalid`, displayName: 'Owner' },
    });

describe('platform operators (T31)', () => {
  it('requires pwd + otp, the platform header and the permission; audits every platform request', async () => {
    const op = await user({ phone: '+8801700000051' });
    await operators().grant({
      email: op.email,
      permissions: ['platform.tenants.bootstrap'],
      grantedBy: 'cli:test',
      grantorUserId: null,
    });
    const auth = await login(op.email);
    expect((await newTenant(auth)).body.code).toBe('FORBIDDEN'); // password-only session
    const up = await stepUp(auth);
    expect({ status: up.status, body: up.body }).toMatchObject({ status: 200 });
    expect(up.body.data.authnMethods).toEqual(['otp', 'pwd']);
    const session = await api.runtime.prisma.session.findFirstOrThrow({ where: { userId: op.id } });
    expect(session.idleExpiresAt.getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000 + 5_000);
    const created = await newTenant(auth).expect(201);
    expect(created.body.data).toMatchObject({
      ownerDoctorProfileId: null,
      slug: expect.stringMatching(/^demo-group-clinic-/),
    });
    expect(
      await api.runtime.prisma.auditLog.count({
        where: { action: 'PLATFORM_REQUEST', actorType: 'OPERATOR', chainKey: 'platform' },
      }),
    ).toBe(1);
    expect((await newTenant(auth, {})).body.code).toBe('PLATFORM_CONTEXT_REQUIRED');
    expect(
      (await newTenant(auth, { 'x-platform-context': 'operator', 'x-tenant-id': created.body.data.tenantId }))
        .body.code,
    ).toBe('PLATFORM_CONTEXT_REQUIRED');
  });

  it('rejects operators without the permission and tenant sessions', async () => {
    const op = await user({ phone: '+8801700000052' });
    await operators().grant({
      email: op.email,
      permissions: ['ops.metrics.read'],
      grantedBy: 'cli:test',
      grantorUserId: null,
    });
    const auth = await login(op.email);
    await stepUp(auth);
    expect((await newTenant(auth)).body.code).toBe('FORBIDDEN');
    const tenantUser = await user({ phone: '+8801700000053' });
    const tAuth = await login(tenantUser.email);
    await stepUp(tAuth);
    expect((await newTenant(tAuth)).body.code).toBe('FORBIDDEN'); // no operator row
    expect((await newTenant(tAuth, {})).body.code).toBe('PLATFORM_CONTEXT_REQUIRED');
  });

  it('validates grants: platform catalog only, prerequisites, no self-grant', async () => {
    const op = await user({ phone: '+8801700000054' });
    await expect(
      operators().grant({
        email: op.email,
        permissions: ['tenant.manage'],
        grantedBy: 'cli:test',
        grantorUserId: null,
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    const noPhone = await user();
    await expect(
      operators().grant({
        email: noPhone.email,
        permissions: ['ops.sms.read'],
        grantedBy: 'cli:test',
        grantorUserId: null,
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(
      operators().grant({
        email: op.email,
        permissions: ['ops.sms.read'],
        grantedBy: op.id,
        grantorUserId: op.id,
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it(
    'the ops:platform-operator CLI grants and revokes with platform-chain audit events',
    { timeout: 180_000 },
    async () => {
      const op = await user({ phone: '+8801700000055' });
      const pkg = path.resolve(__dirname, '../../../../packages/identity-access');
      // Builds the CLI's package (a no-op when CI pre-built it). Surface tsc's own output on failure.
      try {
        execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-b'], {
          cwd: pkg,
          stdio: ['ignore', 'pipe', 'pipe'],
          encoding: 'utf8',
        });
      } catch (error) {
        const e = error as { stdout?: string; stderr?: string; message: string };
        throw new Error(`tsc -b failed in ${pkg}:\n${e.stdout ?? ''}\n${e.stderr ?? ''}\n${e.message}`);
      }
      const run = (...args: string[]) =>
        execFileSync(process.execPath, ['dist/cli/platform-operator.js', ...args], {
          cwd: pkg,
          env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
          encoding: 'utf8',
        });
      expect(run('grant', '--email', op.email, '--permissions', 'ops.metrics.read,ops.sms.read')).toContain(
        'PLATFORM_OPERATOR_GRANTED',
      );
      expect(run('revoke', '--email', op.email)).toContain('PLATFORM_OPERATOR_REVOKED');
      const actions = (
        await api.runtime.prisma.auditLog.findMany({
          where: { chainKey: 'platform' },
          orderBy: { seq: 'asc' },
        })
      ).map((a) => a.action);
      expect(actions).toEqual(['PLATFORM_OPERATOR_GRANTED', 'PLATFORM_OPERATOR_REVOKED']);
    },
  );
});

describe('memberships and coverages over HTTP (ID-006)', () => {
  async function ownerOfNewTenant() {
    const owner = await user();
    const t = await new TenantBootstrapService(api.runtime.prisma, api.runtime.audit).bootstrap({
      name: 'DEMO Clinic',
      practiceType: 'GROUP',
      owner: { email: owner.email, displayName: 'Owner' },
      actor: { userId: null, type: 'SYSTEM' },
    });
    const auth = await login(owner.email);
    return { tenantId: t.tenantId, auth: { ...auth, 'x-tenant-id': t.tenantId } };
  }

  it('creates members, rejects platform permissions (T31), and denies roles without membership.manage', async () => {
    const { auth, tenantId } = await ownerOfNewTenant();
    const bad = await request(server)
      .post('/api/v1/memberships')
      .set(auth)
      .set('idempotency-key', idem())
      .send({
        email: 'nurse.a@example.invalid',
        displayName: 'Nurse A',
        role: 'nurse',
        permissions: { grants: ['ops.jobs.replay'], denials: [] },
      })
      .expect(400);
    expect(bad.body.fieldErrors[0]).toMatchObject({ code: 'PLATFORM_PERMISSION' });
    const nurseEmail = `nurse.${newId().slice(-8)}@example.invalid`;
    await request(server)
      .post('/api/v1/memberships')
      .set(auth)
      .set('idempotency-key', idem())
      .send({ email: nurseEmail, displayName: 'Nurse B', role: 'nurse' })
      .expect(201);
    const list = await request(server).get('/api/v1/memberships').set(auth).expect(200);
    expect(list.body.data.map((m: { role: string }) => m.role).sort()).toEqual(['nurse', 'tenant_owner']);
    // The nurse has no password yet; give one directly and try to manage memberships.
    await api.runtime.prisma.user.update({
      where: { emailNormalized: nurseEmail },
      data: { passwordHash: await hasher.hash(PASSWORD) },
    });
    const nurseAuth = { ...(await login(nurseEmail)), 'x-tenant-id': tenantId };
    expect((await request(server).get('/api/v1/memberships').set(nurseAuth).expect(403)).body.code).toBe(
      'FORBIDDEN',
    );
    expect(await api.runtime.prisma.auditLog.count({ where: { action: 'AUTHZ_DENIED', tenantId } })).toBe(1);
  });

  it('grants and revokes a coverage with optimistic concurrency', async () => {
    const { auth } = await ownerOfNewTenant();
    const mk = async (name: string) =>
      (
        await request(server)
          .post('/api/v1/memberships')
          .set(auth)
          .set('idempotency-key', idem())
          .send({ email: `${name}.${newId().slice(-8)}@example.invalid`, displayName: name, role: 'doctor' })
          .expect(201)
      ).body.data.userId as string;
    const [a, b] = [await mk('dra'), await mk('drb')];
    const profile = async (userId: string) =>
      (await api.runtime.prisma.doctorProfile.findFirstOrThrow({ where: { userId } })).id;
    const now = Date.now();
    const cov = await request(server)
      .post('/api/v1/doctor-coverages')
      .set(auth)
      .set('idempotency-key', idem())
      .send({
        coveredDoctorProfileId: await profile(a),
        coveringDoctorProfileId: await profile(b),
        startsAt: new Date(now).toISOString(),
        endsAt: new Date(now + 3 * 86_400_000).toISOString(),
        reason: 'Leave',
      })
      .expect(201);
    const stale = await request(server)
      .post(`/api/v1/doctor-coverages/${cov.body.data.id}/revoke`)
      .set(auth)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: 9 });
    expect(stale.body.code).toBe('STALE_VERSION');
    await request(server)
      .post(`/api/v1/doctor-coverages/${cov.body.data.id}/revoke`)
      .set(auth)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: cov.body.data.rowVersion })
      .expect(200);
  });
});
