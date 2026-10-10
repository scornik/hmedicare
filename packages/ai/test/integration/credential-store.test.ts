import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@hmedic/kernel';
import type { Database } from '@hmedic/database';
import { PrismaAuditPort } from '@hmedic/audit';
import { SecretEnvelope, kekFromBase64 } from '@hmedic/secrets';
import { AICredentialStore, AICredentialSecrets, type AICredentialActor } from '../../src/public';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';

let db: Database;
let store: AICredentialStore;
const now = new Date('2026-10-11T00:00:00Z');
const secret = 'synthetic_test_credential_0123456789';
const envelope = new SecretEnvelope({
  current: kekFromBase64('test-ai-1', randomBytes(32).toString('base64')),
});
beforeAll(() => {
  db = openTestDatabase();
  store = new AICredentialStore({
    prisma: db.prisma,
    audit: new PrismaAuditPort({ now: () => now }),
    secrets: new AICredentialSecrets(envelope, randomBytes(32).toString('base64')),
    enabledProviderCodes: ['mock', 'mock_alt'],
    clock: { now: () => now },
    metadata: (providerCode, tier) =>
      ['mock', 'mock_alt'].includes(providerCode)
        ? {
            providerCode,
            tier,
            dataUsePolicy: 'MAY_TRAIN_OR_REVIEW',
            productionGate: 'OPEN',
            capabilities: ['text'],
            usageRestrictions: ['SYNTHETIC_DATA_ONLY'],
          }
        : null,
  });
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await truncateAll();
});

async function actor(tenantId = newId(), grants: string[] = []) {
  if (!(await db.prisma.tenant.count({ where: { id: tenantId } })))
    await db.prisma.tenant.create({
      data: {
        id: tenantId,
        name: 'AI fixture',
        slug: `ai-${tenantId}`,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
    });
  const userId = newId(),
    doctorProfileId = newId(),
    membershipId = newId();
  await db.prisma.user.create({
    data: {
      id: userId,
      email: `${userId}@example.invalid`,
      emailNormalized: `${userId}@example.invalid`,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.prisma.tenantMembership.create({
    data: {
      id: membershipId,
      tenantId,
      userId,
      role: 'doctor',
      permissions: { grants },
      clinicIds: [],
      chamberIds: [],
      status: 'ACTIVE',
      rolePermissionsVersion: 2,
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.prisma.doctorProfile.create({
    data: {
      id: doctorProfileId,
      tenantId,
      userId,
      displayName: 'Fixture doctor',
      specialties: [],
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  return { userId, tenantId, doctorProfileId, membershipId };
}
const create = (a: AICredentialActor & { doctorProfileId: string }, key = secret) =>
  store.create(a, a.doctorProfileId, {
    providerCode: 'mock',
    declaredTier: 'FREE',
    billingMode: 'DOCTOR_BYOK_FREE',
    secret: key,
  });
const ack = (a: Awaited<ReturnType<typeof actor>>, providerCode = 'mock') => ({
  id: newId(),
  tenantId: a.tenantId,
  doctorProfileId: a.doctorProfileId,
  providerCode,
  tier: 'FREE',
  termsTextVersion: 'v1',
  termsTextSha256: 'a'.repeat(64),
  acknowledgedByUserId: a.userId,
  acknowledgedAt: now,
  createdAt: now,
  updatedAt: now,
});

describe('durable AI credential owner', () => {
  it('stores encrypted material and emits identifiers-only events with safe metadata responses', async () => {
    const a = await actor();
    const view = await create(a);
    expect(view).toMatchObject({ status: 'PENDING_VALIDATION', secretLast4: '6789', rowVersion: 1 });
    expect(Object.keys(view)).not.toContain('encryptedSecret');
    const row = await db.prisma.aiProviderCredential.findUniqueOrThrow({ where: { id: view.id } });
    expect(envelope.decrypt(row, `${row.id}|${a.tenantId}|${a.doctorProfileId}|mock`)).toEqual({
      apiKey: secret,
    });
    const exposed = JSON.stringify(
      {
        view,
        list: await store.list(a, a.doctorProfileId),
        events: await db.prisma.outboxEvent.findMany(),
        audit: await db.prisma.auditLog.findMany(),
      },
      (_, value) => (typeof value === 'bigint' ? value.toString() : value),
    );
    expect(exposed).not.toContain(secret);
    expect(exposed).not.toContain(row.encryptedSecret);
    expect(exposed).not.toContain(row.secretFingerprint);
    expect(await db.prisma.auditLog.count({ where: { action: 'AI_CREDENTIAL_CREATED' } })).toBe(1);
  });
  it('rejects duplicates but allows the same secret under another owning doctor', async () => {
    const a = await actor(),
      b = await actor(a.tenantId);
    await create(a);
    await expect(create(a)).rejects.toMatchObject({ code: 'AI_CREDENTIAL_DUPLICATE' });
    await expect(create(b)).resolves.toMatchObject({ status: 'PENDING_VALIDATION' });
    expect(await db.prisma.aiProviderCredential.count()).toBe(2);
  });
  it('requires ownership or a live explicit management permission within the tenant', async () => {
    const a = await actor(),
      b = await actor(a.tenantId),
      other = await actor();
    await expect(store.list(b, a.doctorProfileId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(store.list(other, a.doctorProfileId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const manager = await actor(a.tenantId, ['ai.credentials.manage']);
    await expect(store.list(manager, a.doctorProfileId)).resolves.toEqual([]);
    await db.prisma.tenantMembership.update({
      where: { id: manager.membershipId },
      data: { status: 'SUSPENDED' },
    });
    await expect(store.list(manager, a.doctorProfileId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('rechecks active users, profiles and tenants', async () => {
    const a = await actor();
    await db.prisma.user.update({ where: { id: a.userId }, data: { status: 'DISABLED' } });
    await expect(create(a)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await db.prisma.user.update({ where: { id: a.userId }, data: { status: 'ACTIVE' } });
    await db.prisma.doctorProfile.update({ where: { id: a.doctorProfileId }, data: { status: 'INACTIVE' } });
    await expect(create(a)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await db.prisma.doctorProfile.update({ where: { id: a.doctorProfileId }, data: { status: 'ACTIVE' } });
    await db.prisma.tenant.update({ where: { id: a.tenantId }, data: { status: 'SUSPENDED' } });
    await expect(create(a)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('requires validation after re-enable and atomically tombstones revoked secrets', async () => {
    const a = await actor();
    const first = await create(a);
    const disabled = await store.change(a, a.doctorProfileId, first.id, 1, 'DISABLE');
    expect(disabled.status).toBe('DISABLED');
    const enabled = await store.change(a, a.doctorProfileId, first.id, 2, 'ENABLE');
    expect(enabled.status).toBe('PENDING_VALIDATION');
    const revoked = await store.change(a, a.doctorProfileId, first.id, 3, 'REVOKE');
    expect(revoked.status).toBe('REVOKED');
    const row = await db.prisma.aiProviderCredential.findUniqueOrThrow({ where: { id: first.id } });
    expect(row.encryptedSecret).toBe('revoked');
    expect(row.wrappedDataKey).toBe('revoked');
    expect(row.secretFingerprint).toBe(`rev_${first.id.replaceAll('-', '')}`);
    await expect(store.change(a, a.doctorProfileId, first.id, 4, 'ENABLE')).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
    expect((await create(a)).id).not.toBe(first.id);
  });
  it('serializes competing mutations with stale-version rejection', async () => {
    const a = await actor(),
      row = await create(a);
    const results = await Promise.allSettled([
      store.change(a, a.doctorProfileId, row.id, 1, 'DISABLE'),
      store.change(a, a.doctorProfileId, row.id, 1, 'REVOKE'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { code: 'STALE_VERSION' } });
  });
  it('blocks unknown providers, tier/billing mismatch and platform-managed credentials', async () => {
    const a = await actor();
    for (const input of [
      {
        providerCode: 'unknown',
        declaredTier: 'FREE' as const,
        billingMode: 'DOCTOR_BYOK_FREE' as const,
        secret,
      },
      {
        providerCode: 'mock',
        declaredTier: 'PAID' as const,
        billingMode: 'DOCTOR_BYOK_FREE' as const,
        secret,
      },
      {
        providerCode: 'mock',
        declaredTier: 'FREE' as const,
        billingMode: 'PLATFORM_MANAGED' as const,
        secret,
      },
    ])
      await expect(store.create(a, a.doctorProfileId, input)).rejects.toThrow();
    expect(await db.prisma.aiProviderCredential.count()).toBe(0);
  });
  it('enforces acknowledgement doctor, provider and tier scope in the database', async () => {
    const a = await actor(),
      b = await actor(a.tenantId);
    const row = await create(a);
    const good = await db.prisma.aiDataUseAcknowledgement.create({ data: ack(a) });
    await db.prisma.aiProviderCredential.update({ where: { id: row.id }, data: { dataUseAckId: good.id } });
    for (const data of [ack(b), ack(a, 'mock_alt'), { ...ack(a), tier: 'PAID' }]) {
      const foreign = await db.prisma.aiDataUseAcknowledgement.create({ data });
      await expect(
        db.prisma.aiProviderCredential.update({ where: { id: row.id }, data: { dataUseAckId: foreign.id } }),
      ).rejects.toThrow();
    }
  });
  it('deduplicates live acknowledgements and requires a revocation reason', async () => {
    const a = await actor();
    const first = await db.prisma.aiDataUseAcknowledgement.create({ data: ack(a) });
    await expect(db.prisma.aiDataUseAcknowledgement.create({ data: ack(a) })).rejects.toThrow();
    await expect(
      db.prisma.aiDataUseAcknowledgement.update({ where: { id: first.id }, data: { revokedAt: now } }),
    ).rejects.toThrow();
    await db.prisma.aiDataUseAcknowledgement.update({
      where: { id: first.id },
      data: { revokedAt: now, revokeReason: 'DOCTOR_WITHDREW' },
    });
    await expect(db.prisma.aiDataUseAcknowledgement.create({ data: ack(a) })).resolves.toBeDefined();
  });
  it('keeps fallbacks within one doctor and removes them on disable', async () => {
    const a = await actor(),
      b = await actor(a.tenantId);
    const row = await create(a);
    const data = {
      id: newId(),
      tenantId: a.tenantId,
      doctorProfileId: a.doctorProfileId,
      credentialId: row.id,
      position: 1,
      createdAt: now,
      updatedAt: now,
    };
    await expect(
      db.prisma.aiCredentialFallback.create({ data: { ...data, doctorProfileId: b.doctorProfileId } }),
    ).rejects.toThrow();
    await db.prisma.aiCredentialFallback.create({ data });
    await store.change(a, a.doctorProfileId, row.id, 1, 'DISABLE');
    expect(await db.prisma.aiCredentialFallback.count()).toBe(0);
  });
  it('enforces credential checks even when bypassing the service', async () => {
    const a = await actor(),
      row = await create(a);
    for (const data of [
      { status: 'UNKNOWN' },
      { maxConcurrency: 5 },
      { billingMode: 'DOCTOR_BYOK_PAID' },
      { allowedModelIds: {} },
      { rowVersion: 0 },
      { status: 'REVOKED' },
    ])
      await expect(db.prisma.aiProviderCredential.update({ where: { id: row.id }, data })).rejects.toThrow();
  });
});
