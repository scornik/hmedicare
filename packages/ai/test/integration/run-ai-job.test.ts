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
  AIJobRunner,
  AIModelCatalogStore,
  AIProviderRegister,
  CURRENT_ACK_TEXT_VERSION,
  RetrievalService,
  acknowledgementTextSha256,
  currentAcknowledgementTexts,
} from '../../src/public';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';
import { chamberWithCalledSerial } from '../../../../tests/support/clinical';

/**
 * `RunAIJob` end to end against the mock provider (AI-001, AI-IMPLEMENTATION §6.2).
 *
 * The happy path matters, but the refusals matter more. Each case below is a way a patient's data
 * could reach a provider it should not have, or a draft could reach a doctor's screen claiming
 * something nobody can check:
 *
 * - a tenant that never enabled AI, a patient who never consented, a doctor no longer assigned;
 * - a credential revoked while the model was answering, and a job cancelled in the same window;
 * - output citing a source that was never sent;
 * - a model that is deprecated between the request and the run.
 *
 * The mock provider makes each of those producible on demand, which is the reason it exists.
 */
let db: Database;
const now = new Date('2026-10-13T09:00:00Z');
const clock = { now: () => now };
let seq = 0;
const secrets = new AICredentialSecrets(
  new SecretEnvelope({ current: kekFromBase64('test-ai-1', randomBytes(32).toString('base64')) }),
  randomBytes(32).toString('base64'),
);
const audit = new PrismaAuditPort({ now: () => now });

let provider: MockAIProvider;
let runner: AIJobRunner;
let catalog: AIModelCatalogStore;

const metadata = (providerCode: string, tier: 'FREE' | 'PAID') => ({
  providerCode,
  tier,
  dataUsePolicy: 'MAY_TRAIN_OR_REVIEW' as const,
  productionGate: 'OPEN' as const,
  capabilities: ['text', 'json_schema'] as const,
  usageRestrictions: ['SYNTHETIC_DATA_ONLY'],
  termsUrl: 'n/a (internal)',
  termsLastVerifiedAt: '2026-09-17',
  processingRegionNotes: 'In process.',
});

function compose(environment: 'test' | 'production' = 'test') {
  provider = new MockAIProvider();
  catalog = new AIModelCatalogStore({ prisma: db.prisma, clock });
  runner = new AIJobRunner({
    prisma: db.prisma,
    audit,
    secrets,
    providers: new AIProviderRegister([provider]),
    retrieval: new RetrievalService({ prisma: db.prisma, now: () => now }),
    environment,
    enabledProviderCodes: ['mock'],
    currentAckTextVersion: CURRENT_ACK_TEXT_VERSION,
    clock,
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

/** A tenant that has enabled AI, a consenting patient, a validated credential and a live model. */
async function fixture(options: { aiEnabled?: boolean; consent?: boolean; acknowledge?: boolean } = {}) {
  const base = await chamberWithCalledSerial(db.prisma, `runai${++seq}`, now);
  await db.prisma.tenantMembership.create({
    data: {
      id: newId(),
      tenantId: base.tenantId,
      userId: base.userId,
      role: 'doctor',
      permissions: { grants: ['ai.use'] },
      clinicIds: [],
      chamberIds: [],
      status: 'ACTIVE',
      rolePermissionsVersion: 2,
      createdAt: now,
      updatedAt: now,
    },
  });
  const encounterId = newId();
  await db.prisma.encounter.create({
    data: {
      id: encounterId,
      tenantId: base.tenantId,
      patientId: base.patientId,
      doctorProfileId: base.doctorProfileId,
      chamberId: base.chamberId,
      serialId: base.serial.id,
      careMode: 'PHYSICAL',
      status: 'IN_PROGRESS',
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.prisma.tenantAiPolicy.create({
    data: {
      id: newId(),
      tenantId: base.tenantId,
      aiEnabled: options.aiEnabled ?? true,
      freeTierAiAllowed: true,
      allowedProviderCodes: ['mock'],
      policyTextVersion: CURRENT_ACK_TEXT_VERSION,
      createdAt: now,
      updatedAt: now,
    },
  });
  if (options.consent !== false) {
    await db.prisma.patientConsent.create({
      data: {
        id: newId(),
        tenantId: base.tenantId,
        patientId: base.patientId,
        purpose: 'ai_assistance',
        status: 'GRANTED',
        policyVersion: 1,
        givenByUserId: base.userId,
        givenByRelationship: 'STAFF_RECORDED',
        capturedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
  }
  let ackId: string | undefined;
  if (options.acknowledge !== false) {
    const text = currentAcknowledgementTexts().find(
      (candidate) => candidate.tier === 'FREE' && candidate.locale === 'en-BD',
    )!;
    const ack = await db.prisma.aiDataUseAcknowledgement.create({
      data: {
        id: newId(),
        tenantId: base.tenantId,
        doctorProfileId: base.doctorProfileId,
        providerCode: 'mock',
        tier: 'FREE',
        termsTextVersion: CURRENT_ACK_TEXT_VERSION,
        termsTextSha256: acknowledgementTextSha256(text.body),
        acknowledgedByUserId: base.userId,
        acknowledgedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
    ackId = ack.id;
  }
  const store = new AICredentialStore({
    prisma: db.prisma,
    audit,
    secrets,
    enabledProviderCodes: ['mock'],
    clock,
    metadata,
  });
  const credential = await store.create(
    { tenantId: base.tenantId, userId: base.userId },
    base.doctorProfileId,
    {
      providerCode: 'mock',
      declaredTier: 'FREE',
      billingMode: 'DOCTOR_BYOK_FREE',
      secret: 'synthetic_test_credential_0123456789',
      ...(ackId ? { dataUseAckId: ackId } : {}),
    },
  );
  await db.prisma.aiProviderCredential.update({
    where: { id: credential.id },
    data: { status: 'ACTIVE', validatedAt: now },
  });
  await catalog.refresh(
    'mock',
    [{ modelId: 'mock-text-1', displayName: 'Mock text 1', capabilities: ['text', 'json_schema'] }],
    ['FREE'],
  );
  // One thing in the record to retrieve, so a draft can cite something.
  await db.prisma.diagnosis.create({
    data: {
      id: newId(),
      tenantId: base.tenantId,
      encounterId,
      patientId: base.patientId,
      authorDoctorProfileId: base.doctorProfileId,
      display: 'SYNTHETIC cough',
      clinicalStatus: 'ACTIVE',
      certainty: 'PROVISIONAL',
      source: 'doctor',
      createdAt: new Date(now.getTime() - 86_400_000),
      updatedAt: new Date(now.getTime() - 86_400_000),
    },
  });
  return { ...base, encounterId, credentialId: credential.id };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** A queued AI job, as the HTTP route will create one. */
async function queued(f: Fixture, over: Record<string, unknown> = {}) {
  const row = await db.prisma.aiJob.create({
    data: {
      id: newId(),
      tenantId: f.tenantId,
      requestedByUserId: f.userId,
      doctorProfileId: f.doctorProfileId,
      patientId: f.patientId,
      encounterId: f.encounterId,
      purpose: 'HISTORY_SUMMARY',
      status: 'QUEUED',
      credentialId: f.credentialId,
      providerCode: 'mock',
      modelId: 'mock-text-1',
      declaredTier: 'FREE',
      billingMode: 'DOCTOR_BYOK_FREE',
      effectiveDataUsePolicy: 'MAY_TRAIN_OR_REVIEW',
      promptTemplateVersion: 'history-summary/v1',
      outputSchemaVersion: 'history-summary/v1',
      sourceSelection: {},
      correlationId: newId(),
      idempotencyKey: `run-${newId()}`,
      createdAt: now,
      updatedAt: now,
      ...over,
    },
  });
  return row;
}

/** Output the mock returns when a schema is requested, shaped for history-summary/v1. */
const summary = (sourceIds: string[] = ['s1']) =>
  JSON.stringify({
    items: [
      {
        category: 'condition',
        text: 'SYNTHETIC cough noted ⟦DAY−1⟧.',
        confidence: 'MEDIUM',
        sourceIds,
      },
    ],
  });

describe('RunAIJob: the happy path', () => {
  it('produces a draft with suggestions that cite real sources', async () => {
    const f = await fixture();
    const job = await queued(f);
    provider.jsonResponse = summary();

    const report = await runner.run(f.tenantId, job.id);
    expect(report.outcome).toBe('SUCCEEDED');
    expect(report.suggestions).toBe(1);
    expect(report.droppedUnsourced).toBe(0);

    const draft = await db.prisma.aiDraft.findFirstOrThrow({ where: { aiJobId: job.id } });
    expect(draft.status).toBe('READY_FOR_REVIEW');
    expect(draft.outputSchemaVersion).toBe('history-summary/v1');
    const suggestions = await db.prisma.aiSuggestion.findMany({ where: { aiDraftId: draft.id } });
    expect(suggestions).toHaveLength(1);
    // The citation is resolved to the record, not kept as the model's `s1`.
    expect(suggestions[0]!.sourceRefs).toMatchObject([{ sourceType: 'diagnosis' }]);
    expect(suggestions[0]!.status).toBe('PENDING');

    const finished = await db.prisma.aiJob.findFirstOrThrow({ where: { id: job.id } });
    expect(finished.status).toBe('SUCCEEDED');
    expect(finished.finishedAt).not.toBeNull();
    // Categories and counts only (AIPOL-004): the report never holds the values it replaced.
    expect(JSON.stringify(finished.minimizationReport)).not.toContain('SYNTHETIC Patient');
  });

  it('restores relative days to dates before persisting', async () => {
    const f = await fixture();
    const job = await queued(f);
    provider.jsonResponse = summary();

    await runner.run(f.tenantId, job.id);
    const suggestion = await db.prisma.aiSuggestion.findFirstOrThrow({});
    // ⟦DAY−1⟧ against a 2026-10-13 anchor is 2026-10-12. A doctor reads dates, not offsets.
    expect(JSON.stringify(suggestion.candidate)).toContain('2026-10-12');
    expect(JSON.stringify(suggestion.candidate)).not.toContain('DAY−1');
  });

  it('records usage for the call', async () => {
    const f = await fixture();
    const job = await queued(f);
    provider.jsonResponse = summary();

    await runner.run(f.tenantId, job.id);
    const ledger = await db.prisma.aiUsageLedgerEntry.findMany({ where: { jobId: job.id } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ outcome: 'SUCCESS', providerCode: 'mock' });
    const counters = await db.prisma.aiUsageCounter.findMany({
      where: { credentialId: f.credentialId },
    });
    // Minute and day windows are independent rows, which is what makes a per-minute limit readable
    // without losing the day's total.
    expect(counters.map((counter) => counter.window).sort()).toEqual(['DAY', 'MINUTE']);
  });

  it('sends no identifier the record holds', async () => {
    const f = await fixture();
    const job = await queued(f);
    provider.jsonResponse = summary();

    await runner.run(f.tenantId, job.id);
    // The mock keeps only the prompt's length, so the assertion is on what it was asked to do: a
    // generate call happened, and the call record holds no patient text.
    expect(provider.calls.map((call) => call.method)).toEqual(['generate']);
    expect(JSON.stringify(provider.calls)).not.toContain('SYNTHETIC Patient');
  });
});

describe('RunAIJob: refusals before anything is sent', () => {
  it('refuses when the tenant has not enabled AI', async () => {
    const f = await fixture({ aiEnabled: false });
    const job = await queued(f);

    const report = await runner.run(f.tenantId, job.id);
    expect(report).toMatchObject({ outcome: 'FAILED', errorClass: 'POLICY_BLOCKED' });
    expect(provider.calls).toHaveLength(0);
  });

  it('refuses when the patient has not consented', async () => {
    const f = await fixture({ consent: false });
    const job = await queued(f);

    const report = await runner.run(f.tenantId, job.id);
    expect(report).toMatchObject({ outcome: 'FAILED', errorClass: 'POLICY_BLOCKED' });
    expect(report.reason).toBe('CONSENT_REQUIRED');
    expect(provider.calls).toHaveLength(0);
  });

  it('refuses a may-train credential with no live acknowledgement', async () => {
    const f = await fixture({ acknowledge: false });
    const job = await queued(f);

    const report = await runner.run(f.tenantId, job.id);
    expect(report).toMatchObject({ outcome: 'FAILED', errorClass: 'POLICY_BLOCKED' });
    expect(report.reason).toBe('ACK_REQUIRED');
    expect(provider.calls).toHaveLength(0);
  });

  it('refuses when the doctor is no longer assigned to the encounter', async () => {
    const f = await fixture();
    const job = await queued(f);
    const otherDoctor = newId();
    // Its own user: one doctor profile per user per tenant.
    const otherUser = newId();
    await db.prisma.user.create({
      data: {
        id: otherUser,
        email: `${otherUser}@example.invalid`,
        emailNormalized: `${otherUser}@example.invalid`,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
    });
    await db.prisma.doctorProfile.create({
      data: {
        id: otherDoctor,
        tenantId: f.tenantId,
        userId: otherUser,
        displayName: 'Other doctor',
        specialties: [],
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
    });
    await db.prisma.encounter.update({
      where: { id: f.encounterId },
      data: { doctorProfileId: otherDoctor },
    });

    const report = await runner.run(f.tenantId, job.id);
    expect(report.reason).toBe('DOCTOR_NOT_ASSIGNED');
    expect(provider.calls).toHaveLength(0);
  });

  it('refuses a model deprecated since the request', async () => {
    const f = await fixture();
    const job = await queued(f);
    await catalog.refresh('mock', [], ['FREE']);

    const report = await runner.run(f.tenantId, job.id);
    expect(report).toMatchObject({ outcome: 'FAILED', errorClass: 'MODEL_UNAVAILABLE' });
    expect(provider.calls).toHaveLength(0);
  });

  it('refuses a revoked credential', async () => {
    const f = await fixture();
    const job = await queued(f);
    await db.prisma.aiProviderCredential.update({
      where: { id: f.credentialId },
      data: { status: 'DISABLED' },
    });

    const report = await runner.run(f.tenantId, job.id);
    expect(report).toMatchObject({ outcome: 'FAILED', errorClass: 'AI_CREDENTIAL_REVOKED' });
    expect(provider.calls).toHaveLength(0);
  });

  it('cancels a job whose cancellation was requested before it ran', async () => {
    const f = await fixture();
    const job = await queued(f, { cancelRequestedAt: now });

    const report = await runner.run(f.tenantId, job.id);
    expect(report.outcome).toBe('CANCELLED');
    expect(provider.calls).toHaveLength(0);
    expect((await db.prisma.aiJob.findFirstOrThrow({ where: { id: job.id } })).status).toBe('CANCELLED');
  });

  it('skips a job that has already finished', async () => {
    const f = await fixture();
    const job = await queued(f, { status: 'SUCCEEDED', finishedAt: now });

    // The platform runner can deliver the same job twice; the second delivery must not overwrite a
    // draft that already exists.
    const report = await runner.run(f.tenantId, job.id);
    expect(report.outcome).toBe('SKIPPED');
    expect(provider.calls).toHaveLength(0);
  });
});

describe('RunAIJob: provider outcomes', () => {
  it.each([
    ['invalid_credential', 'INVALID_CREDENTIAL', 'INVALID'],
    ['quota_exhausted', 'QUOTA_EXHAUSTED', 'QUOTA_EXHAUSTED'],
  ] as [MockAIScenario, string, string][])(
    'settles the credential on %s',
    async (scenario, errorClass, credentialStatus) => {
      const f = await fixture();
      const job = await queued(f);
      provider.enqueue(scenario);

      const report = await runner.run(f.tenantId, job.id);
      expect(report).toMatchObject({ outcome: 'FAILED', errorClass });
      // Settled here, which is what stops every later job trying the same spent or rejected key.
      const credential = await db.prisma.aiProviderCredential.findFirstOrThrow({
        where: { id: f.credentialId },
      });
      expect(credential.status).toBe(credentialStatus);
      const ledger = await db.prisma.aiUsageLedgerEntry.findFirstOrThrow({ where: { jobId: job.id } });
      expect(ledger).toMatchObject({ outcome: 'ERROR', errorClass });
    },
  );

  it('waits on a rate limit and records when to retry', async () => {
    const f = await fixture();
    const job = await queued(f);
    provider.enqueue('rate_limited');

    const report = await runner.run(f.tenantId, job.id);
    expect(report.outcome).toBe('WAITING_RATE_LIMIT');
    // 30 seconds is what the mock reports.
    expect(report.retryAt?.toISOString()).toBe(new Date(now.getTime() + 30_000).toISOString());
    expect((await db.prisma.aiJob.findFirstOrThrow({ where: { id: job.id } })).status).toBe(
      'WAITING_RATE_LIMIT',
    );
    const counter = await db.prisma.aiUsageCounter.findFirstOrThrow({
      where: { credentialId: f.credentialId, window: 'MINUTE' },
    });
    // The counter remembers it, so the next job throttles itself instead of earning another 429.
    expect(counter.retryAfterUntil).not.toBeNull();
  });

  it('throttles itself when the counter says the provider is still refusing', async () => {
    const f = await fixture();
    const job = await queued(f);
    await db.prisma.aiUsageCounter.create({
      data: {
        credentialId: f.credentialId,
        tenantId: f.tenantId,
        window: 'MINUTE',
        windowStart: now,
        retryAfterUntil: new Date(now.getTime() + 120_000),
        last429At: now,
        updatedAt: now,
      },
    });

    const report = await runner.run(f.tenantId, job.id);
    expect(report).toMatchObject({ outcome: 'WAITING_RATE_LIMIT', reason: 'CLIENT_SIDE_THROTTLE' });
    // A 429 we can avoid costs the doctor nothing.
    expect(provider.calls).toHaveLength(0);
  });

  it.each(['provider_unavailable', 'unknown_outcome'] as MockAIScenario[])(
    'requeues on %s without settling anything',
    async (scenario) => {
      const f = await fixture();
      const job = await queued(f);
      provider.enqueue(scenario);

      const report = await runner.run(f.tenantId, job.id);
      expect(report.outcome).toBe('RETRY');
      const after = await db.prisma.aiJob.findFirstOrThrow({ where: { id: job.id } });
      expect(after.status).toBe('QUEUED');
      expect(after.finishedAt).toBeNull();
      // The credential is untouched: nothing here said the key was the problem.
      expect(
        (await db.prisma.aiProviderCredential.findFirstOrThrow({ where: { id: f.credentialId } })).status,
      ).toBe('ACTIVE');
    },
  );

  it('fails on blocked content without retrying', async () => {
    const f = await fixture();
    const job = await queued(f);
    provider.enqueue('content_blocked');

    const report = await runner.run(f.tenantId, job.id);
    expect(report).toMatchObject({ outcome: 'FAILED', errorClass: 'CONTENT_BLOCKED' });
  });
});

describe('RunAIJob: output the model got wrong', () => {
  it('drops a suggestion citing a source that was never sent', async () => {
    const f = await fixture();
    const job = await queued(f);
    provider.jsonResponse = summary(['s99']);

    const report = await runner.run(f.tenantId, job.id);
    expect(report.outcome).toBe('SUCCEEDED');
    // An invented citation looks checkable and is not, which is worse than no suggestion.
    expect(report.suggestions).toBe(0);
    expect(report.droppedUnsourced).toBe(1);
    const draft = await db.prisma.aiDraft.findFirstOrThrow({ where: { aiJobId: job.id } });
    // The draft still exists and says what it dropped, so a thin result is explainable rather than
    // looking like the model had nothing to say.
    expect(draft.droppedUnsourcedCount).toBe(1);
  });

  it('fails after the schema retry is spent', async () => {
    const f = await fixture();
    const job = await queued(f);
    // Not JSON at all, twice: one retry then a refusal.
    provider.jsonResponse = 'not json';

    const report = await runner.run(f.tenantId, job.id);
    expect(report).toMatchObject({ outcome: 'FAILED', errorClass: 'SCHEMA_INVALID' });
    // Two calls: the first attempt and the one retry.
    expect(provider.calls).toHaveLength(2);
    const ledger = await db.prisma.aiUsageLedgerEntry.findMany({ where: { jobId: job.id } });
    expect(ledger).toHaveLength(2);
  });

  it('marks everything low confidence when the model used a token nobody issued', async () => {
    const f = await fixture();
    const job = await queued(f);
    provider.jsonResponse = JSON.stringify({
      items: [
        {
          category: 'condition',
          text: 'Discussed with ⟦RELATED_9⟧.',
          confidence: 'HIGH',
          sourceIds: ['s1'],
        },
      ],
    });

    await runner.run(f.tenantId, job.id);
    const suggestion = await db.prisma.aiSuggestion.findFirstOrThrow({});
    // The model referred to something that was never sent, so its own confidence is not credible.
    expect(suggestion.confidence).toBe('LOW');
    expect(JSON.stringify(suggestion.candidate)).toContain('⟦RELATED_9⟧');
  });
});

describe('RunAIJob: races with revocation and cancellation', () => {
  it('discards a result for a credential revoked while the model answered', async () => {
    const f = await fixture();
    const job = await queued(f);
    provider.jsonResponse = summary();
    provider.beforeReturn = async () => {
      await db.prisma.aiProviderCredential.update({
        where: { id: f.credentialId },
        data: {
          status: 'REVOKED',
          revokedAt: now,
          revokedByUserId: f.userId,
          encryptedSecret: 'revoked',
          wrappedDataKey: 'revoked',
          keyId: 'revoked',
          secretLast4: '',
          secretFingerprint: `rev_${f.credentialId.replaceAll('-', '')}`,
        },
      });
    };

    const report = await runner.run(f.tenantId, job.id);
    // ADR-017 §4: results obtained after revocation are discarded.
    expect(report).toMatchObject({ outcome: 'FAILED', errorClass: 'AI_CREDENTIAL_REVOKED' });
    expect(await db.prisma.aiDraft.count()).toBe(0);
  });

  it('discards a result for a job cancelled while the model answered', async () => {
    const f = await fixture();
    const job = await queued(f);
    provider.jsonResponse = summary();
    provider.beforeReturn = async () => {
      await db.prisma.aiJob.update({ where: { id: job.id }, data: { cancelRequestedAt: now } });
    };

    const report = await runner.run(f.tenantId, job.id);
    // A draft nobody is waiting for still contains their patient's data.
    expect(report.outcome).toBe('CANCELLED');
    expect(await db.prisma.aiDraft.count()).toBe(0);
  });
});
