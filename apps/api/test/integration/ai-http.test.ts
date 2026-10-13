import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type ServerConfig, loadConfig } from '@hmedic/config';
import { generateSecret, testEnv } from '@hmedic/config/testing';
import { newId } from '@hmedic/kernel';
import { Argon2idHasher, PolicyEngine } from '@hmedic/identity-access';
import { CURRENT_ACK_TEXT_VERSION } from '@hmedic/ai';
import { type ApiInstance, buildApi } from '../../src/compose';
import { testDatabaseUrl, truncateAll } from '../../../../tests/support/db';

/**
 * AI policy, acknowledgements and credentials over HTTP (AICRED-003, AIPOL-001/002).
 *
 * The stores own the rules and have their own suites; this proves the wiring — that each route carries
 * the permission the matrix says it does, that a secret never comes back in a response, and that the
 * policy's stored and effective values both reach the client.
 */
const PASSWORD = 'correct horse battery';
let api: ApiInstance;
let server: Parameters<typeof request>[0];
let seq = 0;
const idem = () => `ai-key-${Date.now()}-${++seq}`;
const hasher = new Argon2idHasher({ memoryKiB: 8192, timeCost: 2, parallelism: 1 });

beforeAll(async () => {
  api = await buildApi(
    loadConfig<ServerConfig>(
      'api',
      testEnv({
        DATABASE_URL: testDatabaseUrl(),
        // Without these the routes are absent by design, so the suite supplies them.
        AI_CREDENTIAL_KEK: generateSecret(),
        AI_CREDENTIAL_KEK_ID: 'test-ai-1',
        AI_CREDENTIAL_FINGERPRINT_PEPPER: generateSecret(),
        AI_ENABLED_PROVIDER_CODES: 'mock',
      }),
    ),
  );
  server = api.app.getHttpServer();
});
afterAll(async () => {
  await api?.close();
});
beforeEach(async () => {
  await truncateAll();
});

async function member(tenantId: string, role: string) {
  const now = new Date();
  const id = newId();
  const email = `ai.${id.slice(-10)}@example.invalid`;
  await api.runtime.prisma.user.create({
    data: {
      id,
      email,
      emailNormalized: email,
      status: 'ACTIVE',
      passwordHash: await hasher.hash(PASSWORD),
      createdAt: now,
      updatedAt: now,
    },
  });
  await api.runtime.prisma.tenantMembership.create({
    data: {
      id: newId(),
      tenantId,
      userId: id,
      role,
      permissions: { grants: [] },
      clinicIds: [],
      chamberIds: [],
      status: 'ACTIVE',
      rolePermissionsVersion: PolicyEngine.version,
      createdAt: now,
      updatedAt: now,
    },
  });
  const login = await request(server)
    .post('/api/v1/auth/password/login')
    .set('idempotency-key', idem())
    .send({ email, password: PASSWORD, client: 'web' })
    .expect(200);
  return {
    userId: id,
    headers: {
      authorization: `Bearer ${login.body.data.accessToken}`,
      'x-tenant-id': tenantId,
    } as Record<string, string>,
  };
}

/** A tenant with an owner, a doctor and that doctor's profile. */
async function fixture() {
  const now = new Date();
  const tenantId = newId();
  await api.runtime.prisma.tenant.create({
    data: {
      id: tenantId,
      name: 'DEMO ai',
      slug: `demo-ai-${tenantId.slice(-8)}`,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  const owner = await member(tenantId, 'tenant_owner');
  const doctorMember = await member(tenantId, 'doctor');
  const doctorProfileId = newId();
  await api.runtime.prisma.doctorProfile.create({
    data: {
      id: doctorProfileId,
      tenantId,
      userId: doctorMember.userId,
      displayName: 'Dr. DEMO ai',
      specialties: [],
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  return { tenantId, owner, doctor: doctorMember, doctorProfileId };
}

const DECISION = {
  aiEnabled: true,
  freeTierAiAllowed: false,
  minimizationRequiredForNoTraining: true,
  rawOutputRetentionDays: 30,
  allowedProviderCodes: ['mock'],
  minAiConsentPolicyVersion: 1,
  policyTextVersion: CURRENT_ACK_TEXT_VERSION,
  reason: 'SYNTHETIC: pilot clinic',
};

describe('AI policy over HTTP', () => {
  it('reads the defaults, records a decision and lists the event', async () => {
    const f = await fixture();

    const before = await request(server).get('/api/v1/tenant/ai-policy').set(f.owner.headers).expect(200);
    expect(before.body.data).toMatchObject({ aiEnabled: false, policyVersion: 0 });

    const decided = await request(server)
      .put('/api/v1/tenant/ai-policy')
      .set(f.owner.headers)
      .set('idempotency-key', idem())
      .send(DECISION)
      .expect(200);
    expect(decided.body.data).toMatchObject({ aiEnabled: true, policyVersion: 1 });

    const events = await request(server)
      .get('/api/v1/tenant/ai-policy/events')
      .set(f.owner.headers)
      .expect(200);
    expect(events.body.data.items).toHaveLength(1);
    expect(events.body.data.items[0]).toMatchObject({ seq: 1, reason: 'SYNTHETIC: pilot clinic' });
  });

  it('refuses a doctor the policy decision', async () => {
    const f = await fixture();
    // `ai.policy.manage` is the owner's; a doctor may not decide for the tenant.
    await request(server)
      .put('/api/v1/tenant/ai-policy')
      .set(f.doctor.headers)
      .set('idempotency-key', idem())
      .send(DECISION)
      .expect(403);
  });

  it('refuses a decision with no reason', async () => {
    const f = await fixture();
    const res = await request(server)
      .put('/api/v1/tenant/ai-policy')
      .set(f.owner.headers)
      .set('idempotency-key', idem())
      .send({ ...DECISION, reason: '' });
    // 400: `VALIDATION_FAILED` is a bad request here, and the contract rejects the empty reason before
    // the store is reached at all.
    expect(res.status).toBe(400);
  });
});

describe('AI acknowledgements over HTTP', () => {
  it('serves the current texts with their hashes', async () => {
    const f = await fixture();
    const res = await request(server)
      .get('/api/v1/ai/acknowledgement-texts')
      .set(f.doctor.headers)
      .expect(200);

    expect(res.body.data.items).toHaveLength(4);
    for (const text of res.body.data.items) {
      expect(text.version).toBe(CURRENT_ACK_TEXT_VERSION);
      expect(text.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    // Both locales reach the client, so a Bangla screen is not served English terms.
    expect(res.body.data.items.map((t: { locale: string }) => t.locale)).toContain('bn-BD');
  });

  it('records and withdraws a doctor’s own acknowledgement', async () => {
    const f = await fixture();

    const recorded = await request(server)
      .post('/api/v1/ai/acknowledgements')
      .set(f.doctor.headers)
      .set('idempotency-key', idem())
      .send({
        doctorProfileId: f.doctorProfileId,
        providerCode: 'mock',
        tier: 'FREE',
        locale: 'en-BD',
        termsTextVersion: CURRENT_ACK_TEXT_VERSION,
      })
      .expect(201);
    expect(recorded.body.data).toMatchObject({ tier: 'FREE', revokedAt: null });
    expect(recorded.body.data.termsTextSha256).toMatch(/^[0-9a-f]{64}$/);

    const withdrawn = await request(server)
      .post(`/api/v1/ai/acknowledgements/${recorded.body.data.id}/withdraw`)
      .set(f.doctor.headers)
      .set('idempotency-key', idem())
      .send({})
      .expect(200);
    expect(withdrawn.body.data.revokeReason).toBe('DOCTOR_WITHDREW');

    const listed = await request(server)
      .get(`/api/v1/doctors/${f.doctorProfileId}/ai/acknowledgements`)
      .set(f.doctor.headers)
      .expect(200);
    // Withdrawing does not delete the record of having agreed.
    expect(listed.body.data.items).toHaveLength(1);
  });

  it('refuses a superseded text version', async () => {
    const f = await fixture();
    const res = await request(server)
      .post('/api/v1/ai/acknowledgements')
      .set(f.doctor.headers)
      .set('idempotency-key', idem())
      .send({
        doctorProfileId: f.doctorProfileId,
        providerCode: 'mock',
        tier: 'FREE',
        locale: 'en-BD',
        termsTextVersion: 'ai-terms-v0',
      });
    // The contract accepts the shape, so this is the store refusing a superseded version.
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });
});

describe('AI credentials over HTTP', () => {
  it('lists nothing for a doctor with no credentials', async () => {
    const f = await fixture();
    const res = await request(server)
      .get(`/api/v1/doctors/${f.doctorProfileId}/ai/credentials`)
      .set(f.doctor.headers)
      .expect(200);
    expect(res.body.data.items).toEqual([]);
  });

  it('stores a credential for a provider the register serves (ADAPT-001)', async () => {
    const f = await fixture();
    const res = await request(server)
      .post(`/api/v1/doctors/${f.doctorProfileId}/ai/credentials`)
      .set(f.doctor.headers)
      .set('idempotency-key', idem())
      .send({
        providerCode: 'mock',
        declaredTier: 'FREE',
        billingMode: 'DOCTOR_BYOK_FREE',
        secret: 'synthetic_test_credential_0123456789',
      })
      .expect(201);
    // PENDING_VALIDATION, never ACTIVE: a key nobody has exercised must not be reachable by a job
    // (AICRED-004 validates it).
    expect(res.body.data).toMatchObject({
      providerCode: 'mock',
      declaredTier: 'FREE',
      status: 'PENDING_VALIDATION',
    });
    // The register serves the mock outside production only, so production still refuses here until a
    // vendor adapter ships (ADAPT-003/004).
    expect(res.body.data.secret).toBeUndefined();
  });

  it('refuses a provider code this deployment does not serve', async () => {
    const f = await fixture();
    // `gemini` is outside this deployment's enabled list and has no adapter yet, and either alone is
    // enough to refuse. Both matter: a provider whose data-use class nothing can state must not be
    // configurable, because the policy engine would have no terms to apply and the assumed default
    // would be the permissive one. `provider-register` unit tests cover the null-metadata path on its
    // own.
    const res = await request(server)
      .post(`/api/v1/doctors/${f.doctorProfileId}/ai/credentials`)
      .set(f.doctor.headers)
      .set('idempotency-key', idem())
      .send({
        providerCode: 'gemini',
        declaredTier: 'FREE',
        billingMode: 'DOCTOR_BYOK_FREE',
        secret: 'synthetic_test_credential_0123456789',
      });
    // 403, which is what `POLICY_BLOCKED` maps to: refused on policy grounds rather than missing.
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('POLICY_BLOCKED');
  });

  it('never echoes a submitted secret, whatever the outcome', async () => {
    const f = await fixture();
    const secret = 'synthetic_never_echoed_0123456789';
    const res = await request(server)
      .post(`/api/v1/doctors/${f.doctorProfileId}/ai/credentials`)
      .set(f.doctor.headers)
      .set('idempotency-key', idem())
      .send({
        providerCode: 'mock',
        declaredTier: 'FREE',
        billingMode: 'DOCTOR_BYOK_FREE',
        secret,
      });
    // Including in the error body: a route that reflects a rejected key back is a route that logs it.
    expect(JSON.stringify(res.body)).not.toContain(secret);
  });

  it('refuses an unrelated doctor the credential list', async () => {
    const f = await fixture();
    const other = await member(f.tenantId, 'doctor');
    await request(server)
      .get(`/api/v1/doctors/${f.doctorProfileId}/ai/credentials`)
      .set(other.headers)
      .expect(403);
  });
});

describe('AI model catalog over HTTP (ADAPT-002)', () => {
  const seed = async (modelId: string, deprecated = false) => {
    const now = new Date();
    await api.runtime.prisma.aiModelCatalogEntry.create({
      data: {
        id: newId(),
        providerCode: 'mock',
        modelId,
        displayName: modelId,
        capabilities: ['text'],
        tierAvailability: ['FREE'],
        contextTokens: 8192,
        ...(deprecated ? { deprecatedAt: now } : {}),
        lastVerifiedAt: now,
        source: 'PROVIDER_API',
        createdAt: now,
        updatedAt: now,
      },
    });
  };

  it('serves live models and omits deprecated ones', async () => {
    const f = await fixture();
    await seed('mock-text-1');
    await seed('mock-withdrawn-1', true);

    const res = await request(server).get('/api/v1/ai/models').set(f.doctor.headers).expect(200);
    // A picker that still offered a withdrawn model would be offering a call the provider refuses.
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0]).toMatchObject({
      providerCode: 'mock',
      modelId: 'mock-text-1',
      tierAvailability: ['FREE'],
      contextTokens: 8192,
      source: 'PROVIDER_API',
    });
    // `deprecatedAt` is not part of the response: every row in it is live by construction.
    expect(res.body.data.items[0].deprecatedAt).toBeUndefined();
  });

  it('filters by provider', async () => {
    const f = await fixture();
    await seed('mock-text-1');
    const res = await request(server)
      .get('/api/v1/ai/models?providerCode=absent')
      .set(f.doctor.headers)
      .expect(200);
    expect(res.body.data.items).toEqual([]);
  });

  it('refuses a member without ai.use', async () => {
    const f = await fixture();
    const receptionist = await member(f.tenantId, 'receptionist');
    await seed('mock-text-1');
    const res = await request(server).get('/api/v1/ai/models').set(receptionist.headers);
    expect(res.status).toBe(403);
  });
});

/**
 * AI job routes (AI-001).
 *
 * The store owns the rules and has its own suite; this proves the wiring — that the permission the
 * matrix names is enforced, that the response is the job rather than a draft, that a retried request
 * returns the first job instead of queuing a second, and that transcription refuses rather than
 * quietly doing nothing.
 */
describe('AI jobs over HTTP (AI-001)', () => {
  /** A consultation the doctor is assigned to, with AI enabled and a validated credential. */
  async function consultation(f: Awaited<ReturnType<typeof fixture>>) {
    const now = new Date();
    const patientId = newId();
    const clinicId = newId();
    const chamberId = newId();
    const chamberDayId = newId();
    const serialId = newId();
    const encounterId = newId();
    const p = api.runtime.prisma;
    await p.patient.create({
      data: {
        id: patientId,
        tenantId: f.tenantId,
        medicalRecordNumber: patientId.slice(-12),
        legalName: 'SYNTHETIC Patient',
        displayName: 'SYNTHETIC Patient',
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
    });
    await p.clinic.create({
      data: {
        id: clinicId,
        tenantId: f.tenantId,
        name: 'DEMO clinic',
        nameNormalizedHash: newId().replace(/-/g, '').padEnd(64, '0').slice(0, 64),
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
    });
    await p.chamber.create({
      data: {
        id: chamberId,
        tenantId: f.tenantId,
        clinicId,
        doctorProfileId: f.doctorProfileId,
        name: 'DEMO chamber',
        supportsPhysical: true,
        supportsRemote: false,
        supportsHybrid: false,
        defaultQueuePolicy: {},
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
    });
    await p.chamberDay.create({
      data: {
        id: chamberDayId,
        tenantId: f.tenantId,
        chamberId,
        doctorProfileId: f.doctorProfileId,
        localDate: now,
        localStartTime: new Date('1970-01-01T00:00:00.000Z'),
        localEndTime: new Date('1970-01-01T23:59:00.000Z'),
        timezone: 'Asia/Dhaka',
        status: 'OPEN',
        queuePolicy: {},
        nextSerialNumber: 2,
        createdAt: now,
        updatedAt: now,
      },
    });
    await p.serial.create({
      data: {
        id: serialId,
        tenantId: f.tenantId,
        chamberDayId,
        patientId,
        serialNumber: 1,
        source: 'WALK_IN',
        careMode: 'PHYSICAL',
        status: 'CALLED',
        createdAt: now,
        updatedAt: now,
      },
    });
    await p.encounter.create({
      data: {
        id: encounterId,
        tenantId: f.tenantId,
        patientId,
        doctorProfileId: f.doctorProfileId,
        chamberId,
        serialId,
        careMode: 'PHYSICAL',
        status: 'IN_PROGRESS',
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
    await p.tenantAiPolicy.create({
      data: {
        id: newId(),
        tenantId: f.tenantId,
        aiEnabled: true,
        freeTierAiAllowed: true,
        allowedProviderCodes: ['mock'],
        policyTextVersion: CURRENT_ACK_TEXT_VERSION,
        createdAt: now,
        updatedAt: now,
      },
    });
    await p.patientConsent.create({
      data: {
        id: newId(),
        tenantId: f.tenantId,
        patientId,
        purpose: 'ai_assistance',
        status: 'GRANTED',
        policyVersion: 1,
        givenByUserId: f.doctor.userId,
        givenByRelationship: 'STAFF_RECORDED',
        capturedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
    const ack = await request(server)
      .post('/api/v1/ai/acknowledgements')
      .set(f.doctor.headers)
      .set('idempotency-key', idem())
      .send({
        doctorProfileId: f.doctorProfileId,
        providerCode: 'mock',
        tier: 'FREE',
        locale: 'en-BD',
        termsTextVersion: CURRENT_ACK_TEXT_VERSION,
      })
      .expect(201);
    const credential = await request(server)
      .post(`/api/v1/doctors/${f.doctorProfileId}/ai/credentials`)
      .set(f.doctor.headers)
      .set('idempotency-key', idem())
      .send({
        providerCode: 'mock',
        declaredTier: 'FREE',
        billingMode: 'DOCTOR_BYOK_FREE',
        secret: 'synthetic_test_credential_0123456789',
        dataUseAckId: ack.body.data.id,
      })
      .expect(201);
    await p.aiProviderCredential.update({
      where: { id: credential.body.data.id },
      data: { status: 'ACTIVE', validatedAt: now },
    });
    await p.aiModelCatalogEntry.create({
      data: {
        id: newId(),
        providerCode: 'mock',
        modelId: 'mock-text-1',
        displayName: 'Mock text 1',
        capabilities: ['text', 'json_schema'],
        tierAvailability: ['FREE'],
        lastVerifiedAt: now,
        source: 'PROVIDER_API',
        createdAt: now,
        updatedAt: now,
      },
    });
    return { encounterId, patientId, credentialId: credential.body.data.id as string };
  }

  it('queues a history-summary job and reports it', async () => {
    const f = await fixture();
    const c = await consultation(f);

    const res = await request(server)
      .post(`/api/v1/encounters/${c.encounterId}/ai/history-summary`)
      .set(f.doctor.headers)
      .set('idempotency-key', idem())
      .send({ sourceSelection: {} })
      .expect(201);

    expect(res.body.data).toMatchObject({
      purpose: 'HISTORY_SUMMARY',
      status: 'QUEUED',
      providerCode: 'mock',
      modelId: 'mock-text-1',
      // Shown beside every suggestion: a doctor needs to know whether the provider may train on it.
      effectiveDataUsePolicy: 'MAY_TRAIN_OR_REVIEW',
    });
    // The platform job row exists, which is what makes the request's promise real.
    const queued = await api.runtime.prisma.job.findMany({ where: { type: 'RunAIJob' } });
    expect(queued).toHaveLength(1);
    expect(queued[0]!.concurrencyKey).toContain(res.body.data.id);
  });

  it('returns the same job for a retried request', async () => {
    const f = await fixture();
    const c = await consultation(f);
    const key = idem();
    const body = { sourceSelection: { draftSections: ['history'] } };

    const first = await request(server)
      .post(`/api/v1/encounters/${c.encounterId}/ai/note-draft`)
      .set(f.doctor.headers)
      .set('idempotency-key', key)
      .send(body)
      .expect(201);
    const second = await request(server)
      .post(`/api/v1/encounters/${c.encounterId}/ai/note-draft`)
      .set(f.doctor.headers)
      .set('idempotency-key', key)
      .send(body);

    expect(second.body.data.id).toBe(first.body.data.id);
    // One job, not two: a doctor pressing a button twice must not send their patient's data twice.
    expect(await api.runtime.prisma.aiJob.count()).toBe(1);
  });

  it('refuses a doctor who is not assigned to the encounter', async () => {
    const f = await fixture();
    const c = await consultation(f);
    const other = await member(f.tenantId, 'doctor');
    await api.runtime.prisma.doctorProfile.create({
      data: {
        id: newId(),
        tenantId: f.tenantId,
        userId: other.userId,
        displayName: 'Dr. other',
        specialties: [],
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const res = await request(server)
      .post(`/api/v1/encounters/${c.encounterId}/ai/history-summary`)
      .set(other.headers)
      .set('idempotency-key', idem())
      .send({ sourceSelection: {} });
    // `ai.use` says what a role may do; the assignment says whose patient it is.
    expect(res.status).toBe(403);
  });

  it('refuses a member without ai.use', async () => {
    const f = await fixture();
    const c = await consultation(f);
    const receptionist = await member(f.tenantId, 'receptionist');

    const res = await request(server)
      .post(`/api/v1/encounters/${c.encounterId}/ai/history-summary`)
      .set(receptionist.headers)
      .set('idempotency-key', idem())
      .send({ sourceSelection: {} });
    expect(res.status).toBe(403);
  });

  it('refuses transcription with FEATURE_DISABLED', async () => {
    const f = await fixture();
    const c = await consultation(f);

    const res = await request(server)
      .post(`/api/v1/encounters/${c.encounterId}/ai/transcription`)
      .set(f.doctor.headers)
      .set('idempotency-key', idem())
      .send({});
    // Not built yet is a different answer from not permitted, and raw audio is the reason for both.
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('FEATURE_DISABLED');
  });

  it('reads and cancels a job', async () => {
    const f = await fixture();
    const c = await consultation(f);
    const created = await request(server)
      .post(`/api/v1/encounters/${c.encounterId}/ai/history-summary`)
      .set(f.doctor.headers)
      .set('idempotency-key', idem())
      .send({ sourceSelection: {} })
      .expect(201);

    const read = await request(server)
      .get(`/api/v1/ai/jobs/${created.body.data.id}`)
      .set(f.doctor.headers)
      .expect(200);
    expect(read.body.data.status).toBe('QUEUED');

    const cancelled = await request(server)
      .post(`/api/v1/ai/jobs/${created.body.data.id}/cancel`)
      .set(f.doctor.headers)
      .set('idempotency-key', idem())
      .send({})
      .expect(200);
    // Queued, so it is cancelled outright rather than merely marked.
    expect(cancelled.body.data.status).toBe('CANCELLED');
  });

  it('refuses an unrelated doctor the job', async () => {
    const f = await fixture();
    const c = await consultation(f);
    const created = await request(server)
      .post(`/api/v1/encounters/${c.encounterId}/ai/history-summary`)
      .set(f.doctor.headers)
      .set('idempotency-key', idem())
      .send({ sourceSelection: {} })
      .expect(201);
    const other = await member(f.tenantId, 'doctor');

    const res = await request(server).get(`/api/v1/ai/jobs/${created.body.data.id}`).set(other.headers);
    // Nobody else learns that a draft was requested for this patient.
    expect(res.status).toBe(403);
  });

  it('refuses when the tenant has not enabled AI', async () => {
    const f = await fixture();
    const c = await consultation(f);
    await api.runtime.prisma.tenantAiPolicy.updateMany({
      where: { tenantId: f.tenantId },
      data: { aiEnabled: false },
    });

    const res = await request(server)
      .post(`/api/v1/encounters/${c.encounterId}/ai/history-summary`)
      .set(f.doctor.headers)
      .set('idempotency-key', idem())
      .send({ sourceSelection: {} });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('POLICY_BLOCKED');
    expect(await api.runtime.prisma.aiJob.count()).toBe(0);
  });
});

/**
 * Draft review over HTTP (AI-002).
 *
 * The store has its own suite; this proves the wiring and the one thing only HTTP can show — that a
 * stale `expectedRowVersion` comes back as 409 rather than silently winning, which is what a second
 * screen open on the same draft would do.
 */
describe('AI draft review over HTTP (AI-002)', () => {
  /** A finished job with a draft and one suggestion, built directly: the runner has its own suite. */
  async function draftFor(f: Awaited<ReturnType<typeof fixture>>) {
    const now = new Date();
    const p = api.runtime.prisma;
    const patientId = newId();
    const clinicId = newId();
    const chamberId = newId();
    const chamberDayId = newId();
    const serialId = newId();
    const encounterId = newId();
    await p.patient.create({
      data: {
        id: patientId,
        tenantId: f.tenantId,
        medicalRecordNumber: patientId.slice(-12),
        legalName: 'SYNTHETIC Patient',
        displayName: 'SYNTHETIC Patient',
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
    });
    await p.clinic.create({
      data: {
        id: clinicId,
        tenantId: f.tenantId,
        name: 'DEMO clinic',
        nameNormalizedHash: newId().replace(/-/g, '').padEnd(64, '0').slice(0, 64),
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
    });
    await p.chamber.create({
      data: {
        id: chamberId,
        tenantId: f.tenantId,
        clinicId,
        doctorProfileId: f.doctorProfileId,
        name: 'DEMO chamber',
        supportsPhysical: true,
        supportsRemote: false,
        supportsHybrid: false,
        defaultQueuePolicy: {},
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
    });
    await p.chamberDay.create({
      data: {
        id: chamberDayId,
        tenantId: f.tenantId,
        chamberId,
        doctorProfileId: f.doctorProfileId,
        localDate: now,
        localStartTime: new Date('1970-01-01T00:00:00.000Z'),
        localEndTime: new Date('1970-01-01T23:59:00.000Z'),
        timezone: 'Asia/Dhaka',
        status: 'OPEN',
        queuePolicy: {},
        nextSerialNumber: 2,
        createdAt: now,
        updatedAt: now,
      },
    });
    await p.serial.create({
      data: {
        id: serialId,
        tenantId: f.tenantId,
        chamberDayId,
        patientId,
        serialNumber: 1,
        source: 'WALK_IN',
        careMode: 'PHYSICAL',
        status: 'CALLED',
        createdAt: now,
        updatedAt: now,
      },
    });
    await p.encounter.create({
      data: {
        id: encounterId,
        tenantId: f.tenantId,
        patientId,
        doctorProfileId: f.doctorProfileId,
        chamberId,
        serialId,
        careMode: 'PHYSICAL',
        status: 'IN_PROGRESS',
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
    const credential = await p.aiProviderCredential.create({
      data: {
        id: newId(),
        tenantId: f.tenantId,
        doctorProfileId: f.doctorProfileId,
        providerCode: 'mock',
        declaredTier: 'FREE',
        billingMode: 'DOCTOR_BYOK_FREE',
        encryptedSecret: 'x',
        wrappedDataKey: 'x',
        keyId: 'test-ai-1',
        secretLast4: '6789',
        secretFingerprint: newId().replace(/-/g, ''),
        status: 'ACTIVE',
        allowedModelIds: [],
        createdByUserId: f.doctor.userId,
        createdAt: now,
        updatedAt: now,
      },
    });
    const job = await p.aiJob.create({
      data: {
        id: newId(),
        tenantId: f.tenantId,
        requestedByUserId: f.doctor.userId,
        doctorProfileId: f.doctorProfileId,
        patientId,
        encounterId,
        purpose: 'HISTORY_SUMMARY',
        status: 'SUCCEEDED',
        finishedAt: now,
        credentialId: credential.id,
        providerCode: 'mock',
        modelId: 'mock-text-1',
        declaredTier: 'FREE',
        billingMode: 'DOCTOR_BYOK_FREE',
        effectiveDataUsePolicy: 'MAY_TRAIN_OR_REVIEW',
        promptTemplateVersion: 'history-summary/v1',
        outputSchemaVersion: 'history-summary/v1',
        sourceSelection: {},
        correlationId: newId(),
        idempotencyKey: `http-review-${newId()}`,
        createdAt: now,
        updatedAt: now,
      },
    });
    const draft = await p.aiDraft.create({
      data: {
        id: newId(),
        tenantId: f.tenantId,
        aiJobId: job.id,
        encounterId,
        patientId,
        draftType: 'HISTORY_SUMMARY',
        status: 'READY_FOR_REVIEW',
        outputSchemaVersion: 'history-summary/v1',
        validatedOutput: { items: [] },
        expiresAt: new Date(now.getTime() + 72 * 3600_000),
        createdAt: now,
        updatedAt: now,
      },
    });
    const suggestion = await p.aiSuggestion.create({
      data: {
        id: newId(),
        tenantId: f.tenantId,
        aiDraftId: draft.id,
        suggestionType: 'HISTORY_ITEM',
        sourceRefs: [{ sourceType: 'diagnosis', sourceId: newId(), occurredAt: now.toISOString() }],
        candidate: { category: 'condition', text: 'SYNTHETIC item.', confidence: 'MEDIUM' },
        confidence: 'MEDIUM',
        status: 'PENDING',
        createdAt: now,
        updatedAt: now,
      },
    });
    return { draftId: draft.id, suggestionId: suggestion.id, encounterId };
  }

  it('serves the draft with its suggestions', async () => {
    const f = await fixture();
    const d = await draftFor(f);

    const res = await request(server).get(`/api/v1/ai/drafts/${d.draftId}`).set(f.doctor.headers).expect(200);
    expect(res.body.data).toMatchObject({ status: 'READY_FOR_REVIEW', draftType: 'HISTORY_SUMMARY' });
    expect(res.body.data.suggestions).toHaveLength(1);
    // Resolved to the record, so a doctor can check the claim rather than taking it on trust.
    expect(res.body.data.suggestions[0].sourceRefs[0]).toMatchObject({ sourceType: 'diagnosis' });
  });

  it('opens, reviews and closes', async () => {
    const f = await fixture();
    const d = await draftFor(f);

    const opened = await request(server)
      .post(`/api/v1/ai/drafts/${d.draftId}/open`)
      .set(f.doctor.headers)
      .set('idempotency-key', idem())
      .send({})
      .expect(200);
    expect(opened.body.data.status).toBe('IN_REVIEW');

    const reviewed = await request(server)
      .post(`/api/v1/ai/suggestions/${d.suggestionId}/review`)
      .set(f.doctor.headers)
      .set('idempotency-key', idem())
      .send({ decision: 'ACCEPT', expectedRowVersion: 1 })
      .expect(200);
    expect(reviewed.body.data.status).toBe('ACCEPTED');

    const closed = await request(server)
      .post(`/api/v1/ai/drafts/${d.draftId}/close`)
      .set(f.doctor.headers)
      .set('idempotency-key', idem())
      .send({})
      .expect(200);
    expect(closed.body.data.status).toBe('CLOSED');
  });

  it('reports a stale row version as a conflict', async () => {
    const f = await fixture();
    const d = await draftFor(f);
    await request(server)
      .post(`/api/v1/ai/suggestions/${d.suggestionId}/review`)
      .set(f.doctor.headers)
      .set('idempotency-key', idem())
      .send({ decision: 'ACCEPT', expectedRowVersion: 1 })
      .expect(200);

    const stale = await request(server)
      .post(`/api/v1/ai/suggestions/${d.suggestionId}/review`)
      .set(f.doctor.headers)
      .set('idempotency-key', idem())
      .send({ decision: 'REJECT', expectedRowVersion: 1 });
    // A second screen open on the same draft must not silently win.
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_VERSION');
  });

  it('refuses a decision once the draft is closed', async () => {
    const f = await fixture();
    const d = await draftFor(f);
    await request(server)
      .post(`/api/v1/ai/drafts/${d.draftId}/close`)
      .set(f.doctor.headers)
      .set('idempotency-key', idem())
      .send({})
      .expect(200);

    const res = await request(server)
      .post(`/api/v1/ai/suggestions/${d.suggestionId}/review`)
      .set(f.doctor.headers)
      .set('idempotency-key', idem())
      .send({ decision: 'ACCEPT', expectedRowVersion: 1 });
    expect(res.body.code).toBe('AI_DRAFT_CLOSED');
  });

  it('refuses a role that does not carry ai.review', async () => {
    const f = await fixture();
    const d = await draftFor(f);
    const nurse = await member(f.tenantId, 'nurse');

    const res = await request(server).get(`/api/v1/ai/drafts/${d.draftId}`).set(nurse.headers);
    expect(res.status).toBe(403);
  });
});

/**
 * Approving a suggestion over HTTP (AI-003).
 *
 * The service has its own suite; this proves the route is wired to the clinical services rather than
 * the AI ones, carries `ai.approve`, and returns the approval. The last case is the one that only HTTP
 * can show: a nurse with `ai.review` is refused at the guard, before anything reads a draft.
 */
describe('approving an AI suggestion over HTTP (AI-003)', () => {
  async function accepted(f: Awaited<ReturnType<typeof fixture>>) {
    const now = new Date();
    const p = api.runtime.prisma;
    const patientId = newId();
    const clinicId = newId();
    const chamberId = newId();
    const chamberDayId = newId();
    const serialId = newId();
    const encounterId = newId();
    await p.patient.create({
      data: {
        id: patientId,
        tenantId: f.tenantId,
        medicalRecordNumber: patientId.slice(-12),
        legalName: 'SYNTHETIC Patient',
        displayName: 'SYNTHETIC Patient',
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
    });
    await p.clinic.create({
      data: {
        id: clinicId,
        tenantId: f.tenantId,
        name: 'DEMO clinic',
        nameNormalizedHash: newId().replace(/-/g, '').padEnd(64, '0').slice(0, 64),
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
    });
    await p.chamber.create({
      data: {
        id: chamberId,
        tenantId: f.tenantId,
        clinicId,
        doctorProfileId: f.doctorProfileId,
        name: 'DEMO chamber',
        supportsPhysical: true,
        supportsRemote: false,
        supportsHybrid: false,
        defaultQueuePolicy: {},
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
    });
    await p.chamberDay.create({
      data: {
        id: chamberDayId,
        tenantId: f.tenantId,
        chamberId,
        doctorProfileId: f.doctorProfileId,
        localDate: now,
        localStartTime: new Date('1970-01-01T00:00:00.000Z'),
        localEndTime: new Date('1970-01-01T23:59:00.000Z'),
        timezone: 'Asia/Dhaka',
        status: 'OPEN',
        queuePolicy: {},
        nextSerialNumber: 2,
        createdAt: now,
        updatedAt: now,
      },
    });
    await p.serial.create({
      data: {
        id: serialId,
        tenantId: f.tenantId,
        chamberDayId,
        patientId,
        serialNumber: 1,
        source: 'WALK_IN',
        careMode: 'PHYSICAL',
        status: 'CALLED',
        createdAt: now,
        updatedAt: now,
      },
    });
    await p.encounter.create({
      data: {
        id: encounterId,
        tenantId: f.tenantId,
        patientId,
        doctorProfileId: f.doctorProfileId,
        chamberId,
        serialId,
        careMode: 'PHYSICAL',
        status: 'IN_PROGRESS',
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
    const note = await p.encounterNote.create({
      data: {
        id: newId(),
        tenantId: f.tenantId,
        encounterId,
        authorDoctorProfileId: f.doctorProfileId,
        status: 'DRAFT',
        history: 'What the doctor wrote.',
        sectionSources: [{ section: 'history', source: 'doctor' }],
        createdAt: now,
        updatedAt: now,
      },
    });
    const credential = await p.aiProviderCredential.create({
      data: {
        id: newId(),
        tenantId: f.tenantId,
        doctorProfileId: f.doctorProfileId,
        providerCode: 'mock',
        declaredTier: 'FREE',
        billingMode: 'DOCTOR_BYOK_FREE',
        encryptedSecret: 'x',
        wrappedDataKey: 'x',
        keyId: 'test-ai-1',
        secretLast4: '6789',
        secretFingerprint: newId().replace(/-/g, ''),
        status: 'ACTIVE',
        allowedModelIds: [],
        createdByUserId: f.doctor.userId,
        createdAt: now,
        updatedAt: now,
      },
    });
    const job = await p.aiJob.create({
      data: {
        id: newId(),
        tenantId: f.tenantId,
        requestedByUserId: f.doctor.userId,
        doctorProfileId: f.doctorProfileId,
        patientId,
        encounterId,
        purpose: 'NOTE_DRAFT',
        status: 'SUCCEEDED',
        finishedAt: now,
        credentialId: credential.id,
        providerCode: 'mock',
        modelId: 'mock-text-1',
        declaredTier: 'FREE',
        billingMode: 'DOCTOR_BYOK_FREE',
        effectiveDataUsePolicy: 'MAY_TRAIN_OR_REVIEW',
        promptTemplateVersion: 'note-draft/v1',
        outputSchemaVersion: 'note-draft/v1',
        sourceSelection: {},
        correlationId: newId(),
        idempotencyKey: `http-appr-${newId()}`,
        createdAt: now,
        updatedAt: now,
      },
    });
    const draft = await p.aiDraft.create({
      data: {
        id: newId(),
        tenantId: f.tenantId,
        aiJobId: job.id,
        encounterId,
        patientId,
        draftType: 'NOTE_DRAFT',
        status: 'IN_REVIEW',
        openedAt: now,
        outputSchemaVersion: 'note-draft/v1',
        validatedOutput: { suggestions: [] },
        expiresAt: new Date(now.getTime() + 72 * 3600_000),
        createdAt: now,
        updatedAt: now,
      },
    });
    const suggestion = await p.aiSuggestion.create({
      data: {
        id: newId(),
        tenantId: f.tenantId,
        aiDraftId: draft.id,
        suggestionType: 'NOTE_SECTION',
        targetSection: 'history',
        sourceRefs: [{ sourceType: 'diagnosis', sourceId: newId(), occurredAt: now.toISOString() }],
        candidate: { suggestionType: 'NOTE_SECTION', targetSection: 'history', text: 'SYNTHETIC text.' },
        confidence: 'MEDIUM',
        status: 'ACCEPTED',
        reviewedAt: now,
        reviewedByDoctorProfileId: f.doctorProfileId,
        createdAt: now,
        updatedAt: now,
      },
    });
    return { suggestionId: suggestion.id, noteId: note.id, encounterId };
  }

  const body = {
    approvedTarget: 'ENCOUNTER_NOTE_SECTION',
    expectedRowVersion: 1,
    attestationVersion: 1,
    noteSection: {
      section: 'history',
      mode: 'APPEND',
      text: 'SYNTHETIC approved text.',
      expectedNoteRowVersion: 1,
    },
  };

  it('writes the section and returns the approval', async () => {
    const f = await fixture();
    const a = await accepted(f);

    const res = await request(server)
      .post(`/api/v1/ai/suggestions/${a.suggestionId}/approve`)
      .set(f.doctor.headers)
      .set('idempotency-key', idem())
      .send(body)
      .expect(201);

    expect(res.body.data).toMatchObject({
      approvedTarget: 'ENCOUNTER_NOTE_SECTION',
      approvedRecordType: 'encounter_note',
      approvedSection: 'history',
    });
    const note = await api.runtime.prisma.encounterNote.findFirstOrThrow({ where: { id: a.noteId } });
    expect(note.history).toBe('What the doctor wrote.\nSYNTHETIC approved text.');
    // The section's provenance names the approval, which is what makes the claim checkable.
    expect(JSON.stringify(note.sectionSources)).toContain(res.body.data.id);
  });

  it('refuses a nurse holding ai.review', async () => {
    const f = await fixture();
    const a = await accepted(f);
    const nurse = await member(f.tenantId, 'nurse');

    const res = await request(server)
      .post(`/api/v1/ai/suggestions/${a.suggestionId}/approve`)
      .set(nurse.headers)
      .set('idempotency-key', idem())
      .send(body);
    // `ai.approve` is doctor-only in the matrix, so this is refused at the guard — before anything
    // reads a draft or touches a chart.
    expect(res.status).toBe(403);
  });
});

describe('AI usage over HTTP (AICRED-005)', () => {
  it('reports a doctor’s own usage and refuses a colleague’s', async () => {
    const f = await fixture();
    const credential = await request(server)
      .post(`/api/v1/doctors/${f.doctorProfileId}/ai/credentials`)
      .set(f.doctor.headers)
      .set('idempotency-key', idem())
      .send({
        providerCode: 'mock',
        declaredTier: 'FREE',
        billingMode: 'DOCTOR_BYOK_FREE',
        secret: 'synthetic_test_credential_0123456789',
      })
      .expect(201);

    const own = await request(server)
      .get(`/api/v1/doctors/${f.doctorProfileId}/ai/usage`)
      .set(f.doctor.headers)
      .expect(200);
    expect(own.body.data.items).toHaveLength(1);
    expect(own.body.data.items[0]).toMatchObject({
      credentialId: credential.body.data.id,
      requestsToday: 0,
      // No provider reports a remaining quota, so nothing is estimated without a configured hint.
      estimatedRemaining: null,
    });

    const other = await member(f.tenantId, 'doctor');
    const otherProfile = newId();
    await api.runtime.prisma.doctorProfile.create({
      data: {
        id: otherProfile,
        tenantId: f.tenantId,
        userId: other.userId,
        displayName: 'Dr. other',
        specialties: [],
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const colleague = await request(server)
      .get(`/api/v1/doctors/${f.doctorProfileId}/ai/usage`)
      .set(other.headers);
    // What a colleague spent on their own key is theirs to know; reading it needs ai.usage.read.
    expect(colleague.status).toBe(403);
  });
});
