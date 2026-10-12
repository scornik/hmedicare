import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@hmedic/kernel';
import type { Database } from '@hmedic/database';
import { JobRegistry, JobRunner } from '@hmedic/jobs';
import { SecretEnvelope, kekFromBase64 } from '@hmedic/secrets';
import { PrismaAuditPort } from '@hmedic/audit';
import { MockAIProvider } from '../../../ai-adapters/mock/src/index';
import {
  AICredentialSecrets,
  AICredentialStore,
  AIModelCatalogStore,
  AIProviderRegister,
  REFRESH_AI_MODEL_CATALOG,
  registerAICatalogJobs,
} from '../../src/public';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';

/**
 * `RefreshAIModelCatalog` (ADAPT-002).
 *
 * The store's own suite covers what a refresh does to rows. What needs the job is the part the store
 * cannot decide: which credential asks, and what happens when there is none or when the provider
 * refuses. Both of those answers have to leave an existing catalog alone, because the alternative —
 * deprecating a provider's models because nobody had a working key this morning — would disable every
 * model a doctor had configured.
 */
let db: Database;
let registry: JobRegistry;
let runner: JobRunner;
let provider: MockAIProvider;
let catalog: AIModelCatalogStore;
const now = new Date('2026-10-12T00:00:00Z');
const clock = { now: () => now };
const secret = 'synthetic_test_credential_0123456789';
const secrets = new AICredentialSecrets(
  new SecretEnvelope({ current: kekFromBase64('test-ai-1', randomBytes(32).toString('base64')) }),
  randomBytes(32).toString('base64'),
);

function compose() {
  provider = new MockAIProvider();
  catalog = new AIModelCatalogStore({ prisma: db.prisma, clock });
  registry = new JobRegistry();
  runner = new JobRunner(db.prisma, registry, {
    strategy: 'skip_locked',
    app: 'test',
    clock,
  });
  registerAICatalogJobs(registry, runner, {
    prisma: db.prisma,
    catalog,
    providers: new AIProviderRegister([provider]),
    secrets,
  });
}

beforeAll(() => {
  db = openTestDatabase();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await truncateAll();
  compose();
});

/** A doctor with one credential, in the status the caller names. */
async function credential(status = 'ACTIVE') {
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
  const store = new AICredentialStore({
    prisma: db.prisma,
    audit: new PrismaAuditPort({ now: () => now }),
    secrets,
    enabledProviderCodes: ['mock'],
    clock,
    metadata: (providerCode, tier) => ({
      providerCode,
      tier,
      dataUsePolicy: 'MAY_TRAIN_OR_REVIEW',
      productionGate: 'OPEN',
      capabilities: ['text'],
      usageRestrictions: ['SYNTHETIC_DATA_ONLY'],
    }),
  });
  const created = await store.create({ tenantId, userId }, doctorProfileId, {
    providerCode: 'mock',
    declaredTier: 'FREE',
    billingMode: 'DOCTOR_BYOK_FREE',
    secret,
  });
  if (status !== 'PENDING_VALIDATION') {
    await db.prisma.aiProviderCredential.update({ where: { id: created.id }, data: { status } });
  }
  return created.id;
}

/** Enqueues the periodic job as the maintenance scheduler would, and runs it. */
async function run(): Promise<string> {
  const jobId = newId();
  await db.prisma.job.create({
    data: {
      id: jobId,
      queue: 'ai',
      type: REFRESH_AI_MODEL_CATALOG,
      payload: { v: 1, window: 1 },
      status: 'QUEUED',
      runAt: now,
      correlationId: newId(),
      createdAt: now,
      updatedAt: now,
    },
  });
  const claimed = await runner.claim('ai', 5);
  const target = claimed.find((job) => job.id === jobId);
  if (!target) throw new Error('job was not claimed');
  return runner.execute(target);
}

describe('RefreshAIModelCatalog', () => {
  it('fills the catalog from the provider using an active credential', async () => {
    await credential();
    expect(await run()).toBe('SUCCEEDED');

    const listed = await catalog.list('mock');
    expect(listed.map((entry) => entry.modelId)).toEqual(['mock-audio-1', 'mock-text-1']);
    // The credential declared FREE, so availability is recorded for FREE and nothing is claimed for
    // the tier it could not see.
    expect(listed[0]?.tierAvailability).toEqual(['FREE']);
    expect(provider.calls.map((call) => call.method)).toEqual(['listModels']);
  });

  it('asks nothing when no credential is active', async () => {
    await credential('PENDING_VALIDATION');
    expect(await run()).toBe('SUCCEEDED');

    // An unvalidated key is not a key anyone has exercised, and a list call with it would be the first
    // use of a credential the validation job has not settled.
    expect(provider.calls).toHaveLength(0);
    expect(await catalog.list('mock')).toEqual([]);
  });

  it('leaves an existing catalog alone when the provider refuses', async () => {
    await credential();
    await catalog.refresh(
      'mock',
      [{ modelId: 'mock-text-1', displayName: 'Mock', capabilities: [] }],
      ['FREE'],
    );
    provider.enqueue('provider_unavailable');
    expect(await run()).toBe('SUCCEEDED');

    // Deprecating a provider's whole catalog because one list call failed would disable every model a
    // doctor had configured, so a refusal changes nothing and the next window asks again.
    expect((await catalog.list('mock')).map((entry) => entry.modelId)).toEqual(['mock-text-1']);
  });

  it('leaves an existing catalog alone when the credential cannot be opened', async () => {
    const id = await credential();
    await catalog.refresh(
      'mock',
      [{ modelId: 'mock-text-1', displayName: 'Mock', capabilities: [] }],
      ['FREE'],
    );
    // Corrupting the envelope stands in for a KEK that no longer decrypts this row.
    await db.prisma.aiProviderCredential.update({
      where: { id },
      data: { encryptedSecret: 'not-a-sealed-secret' },
    });
    expect(await run()).toBe('SUCCEEDED');

    expect((await catalog.list('mock')).map((entry) => entry.modelId)).toEqual(['mock-text-1']);
  });

  it('succeeds with nothing to do when no adapter is composed', async () => {
    await credential();
    registry = new JobRegistry();
    runner = new JobRunner(db.prisma, registry, { strategy: 'skip_locked', app: 'test', clock });
    registerAICatalogJobs(registry, runner, {
      prisma: db.prisma,
      catalog,
      providers: new AIProviderRegister(),
      secrets,
    });
    // Production's state until a vendor adapter ships: there is nothing to ask, which is not a failure.
    expect(await run()).toBe('SUCCEEDED');
    expect(await catalog.list()).toEqual([]);
  });

  it('schedules itself daily', () => {
    const periodic = registerAICatalogJobs(new JobRegistry(), null, {
      prisma: db.prisma,
      catalog,
      providers: new AIProviderRegister([new MockAIProvider()]),
      secrets,
    });
    expect(periodic).toEqual([{ type: REFRESH_AI_MODEL_CATALOG, everyMs: 86_400_000 }]);
  });
});
