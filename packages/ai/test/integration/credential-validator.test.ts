import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@hmedic/kernel';
import type { Database } from '@hmedic/database';
import { PrismaAuditPort } from '@hmedic/audit';
import { SecretEnvelope, kekFromBase64 } from '@hmedic/secrets';
import { MockAIProvider, type MockAIScenario } from '../../../ai-adapters/mock/src/index';
import {
  AICredentialSecrets,
  AICredentialStore,
  AICredentialValidator,
  AIProviderRegister,
  type AICredentialActor,
} from '../../src/public';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';

/**
 * `ValidateAICredential`'s use case against the database (AICRED-004).
 *
 * The mapping itself is covered by unit tests; what needs a database is everything around it. That a
 * settled status is written once and read back by the next attempt. That a revocation landing while
 * the provider was answering discards the result instead of resurrecting the credential. That an
 * inconclusive attempt leaves the status where it was. And that neither the key nor a provider
 * message reaches the audit trail or the outbox.
 */
let db: Database;
const now = new Date('2026-10-12T00:00:00Z');
const secret = 'synthetic_test_credential_0123456789';
const envelope = new SecretEnvelope({
  current: kekFromBase64('test-ai-1', randomBytes(32).toString('base64')),
});
const secrets = new AICredentialSecrets(envelope, randomBytes(32).toString('base64'));
const audit = new PrismaAuditPort({ now: () => now });
const metadata = (providerCode: string, tier: 'FREE' | 'PAID') =>
  providerCode === 'mock'
    ? {
        providerCode,
        tier,
        dataUsePolicy: 'MAY_TRAIN_OR_REVIEW' as const,
        productionGate: 'OPEN' as const,
        capabilities: ['text'] as const,
        usageRestrictions: ['SYNTHETIC_DATA_ONLY'],
      }
    : null;

let store: AICredentialStore;
let provider: MockAIProvider;
let validator: AICredentialValidator;

function compose(environment = 'test') {
  provider = new MockAIProvider();
  validator = new AICredentialValidator({
    prisma: db.prisma,
    audit,
    secrets,
    providers: new AIProviderRegister([provider]),
    environment,
    clock: { now: () => now },
  });
}

beforeAll(() => {
  db = openTestDatabase();
  store = new AICredentialStore({
    prisma: db.prisma,
    audit,
    secrets,
    enabledProviderCodes: ['mock'],
    clock: { now: () => now },
    metadata,
  });
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await truncateAll();
  compose();
});

async function actor(declaredTier: 'FREE' | 'PAID' = 'FREE') {
  const tenantId = newId(),
    userId = newId(),
    doctorProfileId = newId();
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
      id: newId(),
      tenantId,
      userId,
      role: 'doctor',
      permissions: { grants: [] },
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
  const a: AICredentialActor & { doctorProfileId: string } = { tenantId, userId, doctorProfileId };
  const credential = await store.create(a, doctorProfileId, {
    providerCode: 'mock',
    declaredTier,
    billingMode: declaredTier === 'FREE' ? 'DOCTOR_BYOK_FREE' : 'DOCTOR_BYOK_PAID',
    secret,
  });
  return { ...a, credentialId: credential.id };
}

const row = (id: string) => db.prisma.aiProviderCredential.findUniqueOrThrow({ where: { id } });

describe('AI credential validation', () => {
  it('activates a credential the provider accepted', async () => {
    const a = await actor();
    const report = await validator.validate(a.tenantId, a.credentialId);

    expect(report).toMatchObject({ outcome: 'ACTIVATED', status: 'ACTIVE' });
    const after = await row(a.credentialId);
    expect(after.validatedAt?.toISOString()).toBe(now.toISOString());
    expect(after.lastErrorClass).toBeNull();
    expect(after.lastErrorReason).toBeNull();
    // No signal from the mock by default, so the declaration still stands on its own.
    expect(after.tierSelfDeclared).toBe(true);
    expect(after.rowVersion).toBe(2);
  });

  it('records the provider confirming the declared tier', async () => {
    const a = await actor('PAID');
    provider.tierSignal = 'PAID';
    await validator.validate(a.tenantId, a.credentialId);
    // Only here does the UI stop saying "tier self-declared", because only here did anyone confirm it.
    expect((await row(a.credentialId)).tierSelfDeclared).toBe(false);
  });

  it('refuses to activate when the provider contradicts the declaration', async () => {
    const a = await actor('PAID');
    provider.tierSignal = 'FREE';
    const report = await validator.validate(a.tenantId, a.credentialId);

    expect(report).toMatchObject({ outcome: 'SETTLED', status: 'INVALID', errorClass: 'TIER_MISMATCH' });
    const after = await row(a.credentialId);
    expect(after.validatedAt).toBeNull();
    expect(after.lastErrorClass).toBe('TIER_MISMATCH');
  });

  it.each([
    ['invalid_credential', 'INVALID', 'INVALID_CREDENTIAL'],
    ['quota_exhausted', 'QUOTA_EXHAUSTED', 'QUOTA_EXHAUSTED'],
  ] as [MockAIScenario, string, string][])('settles %s as %s', async (scenario, status, errorClass) => {
    const a = await actor();
    provider.enqueue(scenario);
    const report = await validator.validate(a.tenantId, a.credentialId);

    expect(report).toMatchObject({ outcome: 'SETTLED', status, errorClass });
    expect((await row(a.credentialId)).status).toBe(status);
  });

  it('defers a rate limit without moving the status, so the next attempt can still work', async () => {
    const a = await actor();
    provider.enqueue('rate_limited');
    const report = await validator.validate(a.tenantId, a.credentialId);

    expect(report).toMatchObject({
      outcome: 'RESCHEDULED',
      status: 'PENDING_VALIDATION',
      errorClass: 'RATE_LIMITED',
    });
    // 30 seconds is what the mock reports. A settled status here would make the rescheduled attempt
    // skip, which is the bug this case exists to catch.
    expect(report.retryAt?.toISOString()).toBe(new Date(now.getTime() + 30_000).toISOString());
    const deferred = await row(a.credentialId);
    expect(deferred.status).toBe('PENDING_VALIDATION');
    expect(deferred.lastErrorClass).toBe('RATE_LIMITED');
    // The row version does not move either: nothing about the credential changed.
    expect(deferred.rowVersion).toBe(1);

    const second = await validator.validate(a.tenantId, a.credentialId);
    expect(second).toMatchObject({ outcome: 'ACTIVATED', status: 'ACTIVE' });
  });

  it.each(['provider_unavailable', 'unknown_outcome', 'provider_error'] as MockAIScenario[])(
    'leaves the status alone on %s',
    async (scenario) => {
      const a = await actor();
      provider.enqueue(scenario);
      const report = await validator.validate(a.tenantId, a.credentialId);

      expect(report.outcome).toBe('INCONCLUSIVE');
      const after = await row(a.credentialId);
      // A transport failure must not disable a working key.
      expect(after.status).toBe('PENDING_VALIDATION');
      expect(after.lastErrorClass).toBe(report.errorClass);
      expect(after.rowVersion).toBe(1);
    },
  );

  it('discards a result for a credential revoked while the provider answered', async () => {
    const a = await actor();
    // Revoking tombstones the secret, so this stands in for the ordering ADR-017 §4 requires: the
    // attempt's answer arrives after the doctor has already moved the credential on.
    await store.change(a, a.doctorProfileId, a.credentialId, 1, 'REVOKE');
    const report = await validator.validate(a.tenantId, a.credentialId);

    expect(report).toMatchObject({ outcome: 'SKIPPED', status: 'REVOKED' });
    expect((await row(a.credentialId)).status).toBe('REVOKED');
    // Nothing was sent, because the status was read before the call.
    expect(provider.calls).toHaveLength(0);
  });

  it('skips a credential that is already settled', async () => {
    const a = await actor();
    await validator.validate(a.tenantId, a.credentialId);
    provider.enqueue('invalid_credential');
    const second = await validator.validate(a.tenantId, a.credentialId);

    expect(second).toMatchObject({ outcome: 'SKIPPED', status: 'ACTIVE' });
    // One provider call in total: a settled credential is not re-exercised on every replay.
    expect(provider.calls).toHaveLength(1);
  });

  it('reports a credential that no longer exists without touching anything', async () => {
    const a = await actor();
    const report = await validator.validate(a.tenantId, newId());
    expect(report).toMatchObject({ outcome: 'SKIPPED', reason: 'CREDENTIAL_NOT_FOUND' });
    expect((await row(a.credentialId)).status).toBe('PENDING_VALIDATION');
  });

  it('refuses to validate another tenant’s credential', async () => {
    const a = await actor();
    const report = await validator.validate(newId(), a.credentialId);
    // Scoped by tenant, so a wrong tenant is indistinguishable from a missing row.
    expect(report).toMatchObject({ outcome: 'SKIPPED', reason: 'CREDENTIAL_NOT_FOUND' });
    expect(provider.calls).toHaveLength(0);
  });

  it('records PROVIDER_NOT_SERVED where no adapter is composed', async () => {
    const a = await actor();
    validator = new AICredentialValidator({
      prisma: db.prisma,
      audit,
      secrets,
      providers: new AIProviderRegister(),
      environment: 'test',
      clock: { now: () => now },
    });
    const report = await validator.validate(a.tenantId, a.credentialId);

    // Production's state until a vendor adapter ships. The key may be fine; nothing can ask.
    expect(report).toMatchObject({ outcome: 'INCONCLUSIVE', errorClass: 'PROVIDER_NOT_SERVED' });
    expect((await row(a.credentialId)).status).toBe('PENDING_VALIDATION');
  });

  it('blocks activation in production while the provider gate is open', async () => {
    const a = await actor();
    compose('production');
    const report = await validator.validate(a.tenantId, a.credentialId);

    // ADR-017 §6: the gate closes only through a reviewed change to adapter metadata and the
    // register. There is no runtime override, and nothing is sent.
    expect(report).toMatchObject({
      outcome: 'BLOCKED',
      status: 'PENDING_VALIDATION',
      errorClass: 'POLICY_BLOCKED',
      reason: 'PROVIDER_PRODUCTION_GATE_OPEN',
    });
    expect(provider.calls).toHaveLength(0);
    const after = await row(a.credentialId);
    expect(after.lastErrorReason).toBe('PROVIDER_PRODUCTION_GATE_OPEN');
    expect(after.status).toBe('PENDING_VALIDATION');
  });

  it('keeps the key and provider messages out of the audit trail and the outbox', async () => {
    const a = await actor();
    provider.enqueue('invalid_credential');
    await validator.validate(a.tenantId, a.credentialId);

    const stored = await row(a.credentialId);
    const exposed = JSON.stringify(
      {
        audit: await db.prisma.auditLog.findMany(),
        events: await db.prisma.outboxEvent.findMany(),
      },
      (_, value) => (typeof value === 'bigint' ? value.toString() : value),
    );
    expect(exposed).not.toContain(secret);
    expect(exposed).not.toContain(stored.encryptedSecret);
    // The adapter's own provider code carries the scenario name; only the normalized class is kept.
    expect(exposed).not.toContain('mock_invalid_credential');
    expect(exposed).toContain('INVALID_CREDENTIAL');
  });

  it('writes a system-actor audit row for every attempt', async () => {
    const a = await actor();
    await validator.validate(a.tenantId, a.credentialId);
    const entries = await db.prisma.auditLog.findMany({ where: { resourceId: a.credentialId } });
    const validated = entries.filter((e) => e.action === 'AI_CREDENTIAL_VALIDATED');
    expect(validated).toHaveLength(1);
    // No user performed this; attributing it to the doctor would be a false record.
    expect(validated[0]).toMatchObject({ actorType: 'SYSTEM', actorUserId: null, outcome: 'SUCCESS' });
  });
});
