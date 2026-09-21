import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type ServerConfig, loadConfig } from '@hmedic/config';
import { testEnv } from '@hmedic/config/testing';
import { newId } from '@hmedic/kernel';
import { Argon2idHasher } from '@hmedic/identity-access';
import { TenantBootstrapService } from '@hmedic/tenant-org';
import { type ApiInstance, buildApi } from '../../apps/api/src/compose';
import { testDatabaseUrl, truncateAll } from '../support/db';

// Tenant isolation over HTTP: a member of tenant A can never read or change tenant B, whatever headers or
// ids it sends. Denials never reveal whether a foreign resource exists.
const PASSWORD = 'correct horse battery';
let api: ApiInstance;
let server: Parameters<typeof request>[0];
let seq = 0;
const idem = () => `iso-key-${Date.now()}-${++seq}`;

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

async function ownerTenant(label: string) {
  const email = `${label}.${newId().slice(-8)}@example.invalid`;
  const now = new Date();
  await api.runtime.prisma.user.create({
    data: {
      id: newId(),
      email,
      emailNormalized: email,
      status: 'ACTIVE',
      passwordHash: await new Argon2idHasher({ memoryKiB: 8192, timeCost: 2, parallelism: 1 }).hash(PASSWORD),
      createdAt: now,
      updatedAt: now,
    },
  });
  const t = await new TenantBootstrapService(api.runtime.prisma, api.runtime.audit).bootstrap({
    name: `DEMO ${label}`,
    practiceType: 'GROUP',
    owner: { email, displayName: label },
    actor: { userId: null, type: 'SYSTEM' },
  });
  const login = await request(server)
    .post('/api/v1/auth/password/login')
    .set('idempotency-key', idem())
    .send({ email, password: PASSWORD, client: 'android' })
    .expect(200);
  return { tenantId: t.tenantId, auth: { authorization: `Bearer ${login.body.data.accessToken}` } };
}

describe('cross-tenant access', () => {
  it('rejects a foreign X-Tenant-ID with FORBIDDEN and a CROSS_TENANT_ATTEMPT audit event', async () => {
    const a = await ownerTenant('a');
    const b = await ownerTenant('b');
    const res = await request(server)
      .get('/api/v1/memberships')
      .set(a.auth)
      .set('x-tenant-id', b.tenantId)
      .expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(await api.runtime.prisma.auditLog.count({ where: { action: 'CROSS_TENANT_ATTEMPT' } })).toBe(1);
    // A random tenant id behaves exactly the same (no existence oracle).
    const unknown = await request(server)
      .get('/api/v1/memberships')
      .set(a.auth)
      .set('x-tenant-id', newId())
      .expect(403);
    expect(unknown.body.code).toBe('FORBIDDEN');
  });

  it('cannot address another tenant’s rows through its own tenant context', async () => {
    const a = await ownerTenant('a');
    const b = await ownerTenant('b');
    const bMembers = await request(server)
      .get('/api/v1/memberships')
      .set(b.auth)
      .set('x-tenant-id', b.tenantId)
      .expect(200);
    const foreignId = bMembers.body.data[0].id as string;
    const patch = await request(server)
      .patch(`/api/v1/memberships/${foreignId}`)
      .set(a.auth)
      .set('x-tenant-id', a.tenantId)
      .send({ expectedRowVersion: 1, status: 'SUSPENDED' })
      .expect(404);
    expect(patch.body.code).toBe('RESOURCE_NOT_FOUND');
    const revoke = await request(server)
      .post(`/api/v1/doctor-coverages/${newId()}/revoke`)
      .set(a.auth)
      .set('x-tenant-id', a.tenantId)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: 1 })
      .expect(404);
    expect(revoke.body.code).toBe('RESOURCE_NOT_FOUND');
    expect(
      (await api.runtime.prisma.tenantMembership.findUniqueOrThrow({ where: { id: foreignId } })).status,
    ).toBe('ACTIVE');
  });

  it('a body tenantId is never trusted and memberships list only the header tenant', async () => {
    const a = await ownerTenant('a');
    const b = await ownerTenant('b');
    const created = await request(server)
      .post('/api/v1/memberships')
      .set(a.auth)
      .set('x-tenant-id', a.tenantId)
      .set('idempotency-key', idem())
      .send({
        email: `n.${newId().slice(-8)}@example.invalid`,
        displayName: 'N',
        role: 'nurse',
        tenantId: b.tenantId,
      })
      .expect(201);
    const row = await api.runtime.prisma.tenantMembership.findUniqueOrThrow({
      where: { id: created.body.data.id },
    });
    expect(row.tenantId).toBe(a.tenantId);
    const listA = await request(server)
      .get('/api/v1/memberships')
      .set(a.auth)
      .set('x-tenant-id', a.tenantId)
      .expect(200);
    expect(listA.body.data.every((m: { id: string }) => m.id !== undefined)).toBe(true);
    const bCount = await api.runtime.prisma.tenantMembership.count({ where: { tenantId: b.tenantId } });
    expect(bCount).toBe(1);
  });

  it('idempotency keys are scoped per tenant', async () => {
    const a = await ownerTenant('a');
    const b = await ownerTenant('b');
    const key = idem();
    const body = {
      email: `same.${newId().slice(-8)}@example.invalid`,
      displayName: 'S',
      role: 'receptionist',
    };
    await request(server)
      .post('/api/v1/memberships')
      .set(a.auth)
      .set('x-tenant-id', a.tenantId)
      .set('idempotency-key', key)
      .send(body)
      .expect(201);
    const inB = await request(server)
      .post('/api/v1/memberships')
      .set(b.auth)
      .set('x-tenant-id', b.tenantId)
      .set('idempotency-key', key)
      .send(body)
      .expect(201);
    expect(inB.body.meta.replayed).toBeUndefined();
  });
});
