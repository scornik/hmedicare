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
