import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type ServerConfig, loadConfig } from '@hmedic/config';
import { testEnv } from '@hmedic/config/testing';
import { newId } from '@hmedic/kernel';
import { createLogger } from '@hmedic/observability';
import { SessionResponse } from '@hmedic/contracts';
import { Argon2idHasher } from '@hmedic/identity-access';
import { type ApiInstance, buildApi } from '../../src/compose';
import { testDatabaseUrl, truncateAll } from '../../../../tests/support/db';

// ID-002/ID-003/ID-004/ID-005 over HTTP (T17 CSRF, refresh reuse, cookie attributes, redaction).
const ORIGIN = 'https://app.example.invalid';
const PASSWORD = 'correct horse battery';
const logLines: string[] = [];
let api: ApiInstance;
let server: Parameters<typeof request>[0];
let key = 0;
const idem = () => `test-key-${Date.now()}-${++key}`;

beforeAll(async () => {
  const config = loadConfig<ServerConfig>(
    'api',
    testEnv({ DATABASE_URL: testDatabaseUrl(), CORS_ALLOWED_ORIGINS: ORIGIN, LOG_LEVEL: 'info' }),
  );
  api = await buildApi(config);
  api.runtime.logger = createLogger({
    app: 'api',
    env: 'test',
    version: 'test',
    bootId: api.runtime.bootId,
    level: 'debug',
    destination: { write: (l: string) => void logLines.push(l) },
  });
  server = api.app.getHttpServer();
});
afterAll(async () => {
  await api?.close();
});
beforeEach(async () => {
  await truncateAll();
});

async function seedStaff(role = 'doctor') {
  const now = new Date();
  const userId = newId();
  const tenantId = newId();
  const email = `doc.${userId.slice(-8)}@example.invalid`;
  const hash = await new Argon2idHasher({ memoryKiB: 8192, timeCost: 1, parallelism: 1 }).hash(PASSWORD);
  const p = api.runtime.prisma;
  await p.user.create({
    data: {
      id: userId,
      email,
      emailNormalized: email,
      status: 'ACTIVE',
      passwordHash: hash,
      createdAt: now,
      updatedAt: now,
    },
  });
  await p.tenant.create({
    data: {
      id: tenantId,
      name: 'DEMO Clinic',
      slug: `demo-${tenantId.slice(-8)}`,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  await p.tenantMembership.create({
    data: {
      id: newId(),
      tenantId,
      userId,
      role,
      permissions: { grants: [], denials: [] },
      clinicIds: [],
      chamberIds: [],
      status: 'ACTIVE',
      rolePermissionsVersion: 2,
      createdAt: now,
      updatedAt: now,
    },
  });
  return { userId, tenantId, email };
}

function cookieHeader(setCookie: string[] | string | undefined): string {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return list.map((c) => c.split(';')[0]).join('; ');
}

async function webLogin(email: string) {
  const res = await request(server)
    .post('/api/v1/auth/password/login')
    .set('idempotency-key', idem())
    .send({ email, password: PASSWORD })
    .expect(200);
  return { res, cookies: cookieHeader(res.headers['set-cookie']), body: res.body.data };
}

describe('password login (web)', () => {
  it('sets __Host- cookies with the right attributes and returns tokens without the refresh token', async () => {
    const s = await seedStaff();
    const { res, body } = await webLogin(s.email);
    SessionResponse.parse(body);
    expect(body.refreshToken).toBeUndefined();
    expect(body.csrfToken).toMatch(/\./);
    const set = res.headers['set-cookie'] as unknown as string[];
    const rt = set.find((c) => c.startsWith('__Host-hm_rt='))!;
    const csrf = set.find((c) => c.startsWith('__Host-hm_csrf='))!;
    expect(rt).toMatch(/HttpOnly/);
    expect(rt).toMatch(/Secure/);
    expect(rt).toMatch(/SameSite=Lax/);
    expect(rt).toMatch(/Path=\//);
    expect(rt).not.toMatch(/Domain=/);
    expect(csrf).toMatch(/SameSite=Strict/);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('refuses to replay a credential-issuing response and stores no token in idempotency records', async () => {
    const s = await seedStaff();
    const k = idem();
    const first = await request(server)
      .post('/api/v1/auth/password/login')
      .set('idempotency-key', k)
      .send({ email: s.email, password: PASSWORD })
      .expect(200);
    const again = await request(server)
      .post('/api/v1/auth/password/login')
      .set('idempotency-key', k)
      .send({ email: s.email, password: PASSWORD })
      .expect(422);
    expect(again.body).toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
      message: 'idempotency.not_replayable',
    });
    const records = JSON.stringify(
      await api.runtime.prisma.idempotencyRecord.findMany({ select: { responseSnapshot: true } }),
    );
    expect(records).not.toContain(first.body.data.accessToken);
    expect(records).not.toContain(first.body.data.csrfToken);
  });

  it('fails generically for a wrong password', async () => {
    const s = await seedStaff();
    const res = await request(server)
      .post('/api/v1/auth/password/login')
      .set('idempotency-key', idem())
      .send({ email: s.email, password: 'wrong password!!' })
      .expect(401);
    expect(res.body).toMatchObject({ code: 'UNAUTHENTICATED', message: 'UNAUTHENTICATED' });
  });
});

describe('request authentication and tenant context', () => {
  it('default-deny: /me requires a bearer token; cookies alone never authenticate', async () => {
    const s = await seedStaff();
    const { cookies } = await webLogin(s.email);
    await request(server).get('/api/v1/me').expect(401);
    await request(server).get('/api/v1/me').set('cookie', cookies).expect(401);
  });

  it('returns memberships and tenant permissions; denies foreign tenants with an audit event', async () => {
    const s = await seedStaff('doctor');
    const other = await seedStaff('tenant_owner');
    const { body } = await webLogin(s.email);
    const auth = { authorization: `Bearer ${body.accessToken}` };
    const me = await request(server).get('/api/v1/me').set(auth).expect(200);
    expect(me.body.data.memberships).toEqual([
      expect.objectContaining({ tenantId: s.tenantId, role: 'doctor' }),
    ]);
    const ctx = await request(server)
      .get('/api/v1/me/tenant-context')
      .set(auth)
      .set('x-tenant-id', s.tenantId)
      .expect(200);
    expect(ctx.body.data.permissions).toContain('prescription.approve');
    expect(ctx.body.data.rolePermissionsVersion).toBe(2);
    const missing = await request(server).get('/api/v1/me/tenant-context').set(auth);
    expect(missing.body.code).toBe('TENANT_CONTEXT_REQUIRED');
    const foreign = await request(server)
      .get('/api/v1/me/tenant-context')
      .set(auth)
      .set('x-tenant-id', other.tenantId)
      .expect(403);
    expect(foreign.body.code).toBe('FORBIDDEN');
    expect(
      await api.runtime.prisma.auditLog.count({
        where: { action: 'CROSS_TENANT_ATTEMPT', actorUserId: s.userId },
      }),
    ).toBe(1);
    const both = await request(server)
      .get('/api/v1/me')
      .set(auth)
      .set('x-tenant-id', s.tenantId)
      .set('x-platform-context', 'operator');
    expect(both.body.code).toBe('PLATFORM_CONTEXT_REQUIRED');
  });
});

describe('web refresh and CSRF (T17)', () => {
  it('requires the CSRF header == cookie, a session-bound signature and an allowed Origin', async () => {
    const s = await seedStaff();
    const { cookies, body } = await webLogin(s.email);
    const refresh = () =>
      request(server).post('/api/v1/auth/session/refresh').set('cookie', cookies).send({});
    expect((await refresh().set('origin', ORIGIN)).body.code).toBe('CSRF_FAILED');
    expect(
      (await refresh().set('origin', 'https://evil.example.invalid').set('x-csrf-token', body.csrfToken)).body
        .code,
    ).toBe('CSRF_FAILED');
    expect((await refresh().set('x-csrf-token', body.csrfToken)).body.code).toBe('CSRF_FAILED');
    expect((await refresh().set('origin', ORIGIN).set('x-csrf-token', `${body.csrfToken}x`)).body.code).toBe(
      'CSRF_FAILED',
    );
    const ok = await refresh().set('origin', ORIGIN).set('x-csrf-token', body.csrfToken).expect(200);
    SessionResponse.parse(ok.body.data);
    // The old refresh cookie is now used: replaying it revokes the family.
    const replay = await refresh().set('origin', ORIGIN).set('x-csrf-token', body.csrfToken);
    expect(replay.body.code).toBe('SESSION_REVOKED');
    await request(server)
      .get('/api/v1/me')
      .set('authorization', `Bearer ${ok.body.data.accessToken}`)
      .expect(401);
  });

  it('issues a fresh CSRF token after a page reload from the refresh cookie', async () => {
    const s = await seedStaff();
    const { cookies } = await webLogin(s.email);
    await request(server).post('/api/v1/auth/session/csrf').set('cookie', cookies).expect(403);
    const res = await request(server)
      .post('/api/v1/auth/session/csrf')
      .set('cookie', cookies)
      .set('origin', ORIGIN)
      .expect(200);
    const newCookies = cookieHeader(res.headers['set-cookie']);
    await request(server)
      .post('/api/v1/auth/session/refresh')
      .set('cookie', newCookies)
      .set('origin', ORIGIN)
      .set('x-csrf-token', res.body.data.csrfToken)
      .send({})
      .expect(200);
  });
});

describe('mobile, logout and OTP', () => {
  it('mobile clients get the refresh token in the body and refresh without cookies', async () => {
    const s = await seedStaff();
    const login = await request(server)
      .post('/api/v1/auth/password/login')
      .set('idempotency-key', idem())
      .send({ email: s.email, password: PASSWORD, client: 'android' })
      .expect(200);
    expect(login.headers['set-cookie']).toBeUndefined();
    const r = await request(server)
      .post('/api/v1/auth/session/refresh')
      .send({ refreshToken: login.body.data.refreshToken })
      .expect(200);
    expect(r.body.data.refreshToken).not.toBe(login.body.data.refreshToken);
  });

  it('logout revokes the session and clears cookies; logout-all revokes every session', async () => {
    const s = await seedStaff();
    const a = await webLogin(s.email);
    const b = await webLogin(s.email);
    const out = await request(server)
      .delete('/api/v1/auth/session')
      .set('authorization', `Bearer ${a.body.accessToken}`)
      .expect(200);
    expect((out.headers['set-cookie'] as unknown as string[]).every((c) => /Max-Age=0/.test(c))).toBe(true);
    expect(
      (await request(server).get('/api/v1/me').set('authorization', `Bearer ${a.body.accessToken}`)).body
        .code,
    ).toBe('SESSION_REVOKED');
    await request(server).get('/api/v1/me').set('authorization', `Bearer ${b.body.accessToken}`).expect(200);
    await request(server)
      .post('/api/v1/auth/session/logout-all')
      .set('authorization', `Bearer ${b.body.accessToken}`)
      .expect(200);
    expect(
      (await request(server).get('/api/v1/me').set('authorization', `Bearer ${b.body.accessToken}`)).body
        .code,
    ).toBe('SESSION_REVOKED');
  });

  it('OTP login via the dev inbox; identical responses for known and unknown phones', async () => {
    const r1 = await request(server)
      .post('/api/v1/auth/otp/request')
      .set('idempotency-key', idem())
      .send({ phone: '01700000031' })
      .expect(202);
    const code = (await request(server).get(`/internal/test/otp/${r1.body.data.challengeId}`).expect(200))
      .body.code;
    const v = await request(server)
      .post('/api/v1/auth/otp/verify')
      .set('idempotency-key', idem())
      .send({ phone: '01700000031', code, client: 'ios' })
      .expect(200);
    expect(v.body.data.user.phoneMasked).toBe('+8801*******31');
    const known = await request(server)
      .post('/api/v1/auth/otp/request')
      .set('idempotency-key', idem())
      .send({ phone: '01700000031' })
      .expect(202);
    const unknown = await request(server)
      .post('/api/v1/auth/otp/request')
      .set('idempotency-key', idem())
      .send({ phone: '01700000032' })
      .expect(202);
    expect(Object.keys(known.body.data).sort()).toEqual(Object.keys(unknown.body.data).sort());
    expect(known.body.data.hint).toBe(unknown.body.data.hint);
    expect(
      (
        await request(server)
          .get('/api/v1/me/patient-contexts')
          .set('authorization', `Bearer ${v.body.data.accessToken}`)
          .expect(200)
      ).body.data,
    ).toEqual([]);
  });
});

describe('redaction (T1)', () => {
  it('never logs passwords, tokens, OTP codes or phone numbers', async () => {
    logLines.length = 0;
    const s = await seedStaff();
    const { body } = await webLogin(s.email);
    await request(server).get('/api/v1/me').set('authorization', `Bearer ${body.accessToken}`).expect(200);
    const otp = await request(server)
      .post('/api/v1/auth/otp/request')
      .set('idempotency-key', idem())
      .send({ phone: '01700000033' })
      .expect(202);
    const code = (await request(server).get(`/internal/test/otp/${otp.body.data.challengeId}`)).body
      .code as string;
    await request(server)
      .post('/api/v1/auth/otp/verify')
      .set('idempotency-key', idem())
      .send({ phone: '01700000033', code: '000000' });
    const logs = logLines.join('\n');
    expect(logs.length).toBeGreaterThan(0);
    for (const secret of [PASSWORD, body.accessToken, body.csrfToken, '8801700000033', '01700000033']) {
      expect(logs).not.toContain(secret);
    }
    expect(logs).not.toContain(`"${code}"`);
  });
});
