import { describe, expect, it } from 'vitest';
import {
  evaluateAIPolicy,
  selectAIFallback,
  type AIPolicyInput,
  type DataUsePolicy,
  type FallbackCandidate,
} from '../../src/public';

function fixture(): AIPolicyInput {
  return {
    environment: 'test',
    tenantId: 'tenant-a',
    doctorProfileId: 'doctor-a',
    tenant: {
      aiEnabled: true,
      freeTierAiAllowed: true,
      minimizationRequiredForNoTraining: true,
      allowedProviderCodes: ['fixture'],
    },
    enabledProviderCodes: ['fixture'],
    credential: {
      id: 'original',
      tenantId: 'tenant-a',
      doctorProfileId: 'doctor-a',
      providerCode: 'fixture',
      declaredTier: 'FREE',
      status: 'ACTIVE',
      billingMode: 'DOCTOR_BYOK_FREE',
    },
    metadata: {
      providerCode: 'fixture',
      tier: 'FREE',
      dataUsePolicy: 'MAY_TRAIN_OR_REVIEW',
      productionGate: 'OPEN',
      capabilities: ['text', 'json_schema', 'audio'],
      usageRestrictions: [],
    },
    assignedDoctor: true,
    patientConsentCurrent: true,
    acknowledgementCurrent: true,
    freeTierProductionGateClosed: false,
    rawMediaFeatureEnabled: true,
    syntheticData: true,
  };
}
const candidate = (id: string, policy: DataUsePolicy): FallbackCandidate => {
  const input = fixture();
  input.credential.id = id;
  input.metadata!.dataUsePolicy = policy;
  return { input, modelSupportsTemplate: true };
};
const original = {
  credentialId: 'original',
  tenantId: 'tenant-a',
  doctorProfileId: 'doctor-a',
  dataUsePolicy: 'NO_TRAINING_CONTRACTUAL' as const,
};

describe('effective AI policy', () => {
  it('requires all eight may-train gates across their complete boolean matrix', () => {
    for (let mask = 0; mask < 256; mask++) {
      const input = fixture();
      const enabled = (bit: number) => Boolean(mask & (1 << bit));
      input.tenant.aiEnabled = enabled(0);
      input.tenant.freeTierAiAllowed = enabled(1);
      input.assignedDoctor = enabled(2);
      input.patientConsentCurrent = enabled(3);
      input.acknowledgementCurrent = enabled(4);
      input.credential.status = enabled(5) ? 'ACTIVE' : 'REVOKED';
      input.tenant.allowedProviderCodes = enabled(6) ? ['fixture'] : [];
      input.enabledProviderCodes = enabled(7) ? ['fixture'] : [];
      const result = evaluateAIPolicy(input);
      expect(result.allowed, `gate mask ${mask}`).toBe(mask === 255);
      if (result.allowed) {
        expect(result.requireMinimization).toBe(true);
        expect(result.allowRawMedia).toBe(false);
      }
    }
  });
  it.each(['tenantId', 'doctorProfileId'] as const)('rejects foreign credential %s', (field) => {
    const input = fixture();
    input.credential[field] = 'other';
    expect(evaluateAIPolicy(input)).toEqual({ allowed: false, reason: 'CREDENTIAL_SCOPE' });
  });
  it.each(['PENDING_VALIDATION', 'INVALID', 'QUOTA_EXHAUSTED', 'DISABLED', 'REVOKED', 'unknown'])(
    'rejects credential status %s',
    (status) => {
      const input = fixture();
      input.credential.status = status;
      expect(evaluateAIPolicy(input).allowed).toBe(false);
    },
  );
  it('blocks missing metadata and provider/tier mismatches', () => {
    for (const mismatch of ['missing', 'provider', 'tier']) {
      const input = fixture();
      if (mismatch === 'missing') input.metadata = null;
      else if (mismatch === 'provider') input.metadata!.providerCode = 'other';
      else input.metadata!.tier = 'PAID';
      expect(evaluateAIPolicy(input)).toEqual({
        allowed: false,
        reason: 'METADATA_MISSING_OR_MISMATCHED',
      });
    }
  });
  it('treats UNKNOWN as may-train even on a paid credential', () => {
    const input = fixture();
    input.metadata!.dataUsePolicy = 'UNKNOWN';
    input.metadata!.tier = input.credential.declaredTier = 'PAID';
    input.credential.billingMode = 'DOCTOR_BYOK_PAID';
    expect(evaluateAIPolicy(input)).toMatchObject({
      allowed: true,
      dataUsePolicy: 'MAY_TRAIN_OR_REVIEW',
      requireMinimization: true,
      allowRawMedia: false,
    });
    input.acknowledgementCurrent = false;
    expect(evaluateAIPolicy(input).allowed).toBe(false);
  });
  it('requires provider review and the independent free-tier gate in production', () => {
    const input = fixture();
    input.environment = 'production';
    expect(evaluateAIPolicy(input)).toMatchObject({ reason: 'PRODUCTION_REVIEW_REQUIRED' });
    input.metadata!.productionGate = 'CLOSED';
    expect(evaluateAIPolicy(input).allowed).toBe(false);
    input.metadata!.productionReviewRecordId = 'review-record';
    expect(evaluateAIPolicy(input)).toMatchObject({ reason: 'FREE_TIER_BLOCKED' });
    input.freeTierProductionGateClosed = true;
    expect(evaluateAIPolicy(input).allowed).toBe(true);
  });
  it('never enables mock in production or synthetic-only metadata with real input', () => {
    const input = fixture();
    input.metadata!.usageRestrictions = ['SYNTHETIC_DATA_ONLY'];
    input.syntheticData = false;
    expect(evaluateAIPolicy(input)).toMatchObject({ reason: 'SYNTHETIC_DATA_ONLY' });
    input.syntheticData = true;
    input.environment = 'production';
    input.credential.providerCode = input.metadata!.providerCode = 'mock';
    input.tenant.allowedProviderCodes = input.enabledProviderCodes = ['mock'];
    input.metadata!.productionGate = 'CLOSED';
    input.metadata!.productionReviewRecordId = 'review';
    input.freeTierProductionGateClosed = true;
    expect(evaluateAIPolicy(input).allowed).toBe(false);
  });
  it('requires capability and feature opt-in for contractual raw media', () => {
    const input = fixture();
    input.metadata!.dataUsePolicy = 'NO_TRAINING_CONTRACTUAL';
    input.acknowledgementCurrent = input.tenant.freeTierAiAllowed = false;
    expect(evaluateAIPolicy(input)).toMatchObject({
      allowed: true,
      requireMinimization: true,
      allowRawMedia: true,
    });
    input.tenant.minimizationRequiredForNoTraining = false;
    input.rawMediaFeatureEnabled = false;
    expect(evaluateAIPolicy(input)).toMatchObject({ requireMinimization: false, allowRawMedia: false });
    input.rawMediaFeatureEnabled = true;
    input.metadata!.capabilities = ['text'];
    expect(evaluateAIPolicy(input)).toMatchObject({ allowRawMedia: false });
    input.patientConsentCurrent = false;
    expect(evaluateAIPolicy(input).allowed).toBe(false);
  });
  it('retains usage restrictions without exposing mutable metadata', () => {
    const input = fixture();
    input.metadata!.usageRestrictions = ['REVIEW_REQUIRED'];
    const decision = evaluateAIPolicy(input);
    input.metadata!.usageRestrictions = [];
    expect(decision).toMatchObject({ usageRestrictions: ['REVIEW_REQUIRED'] });
  });
  it('rejects tier/billing mismatch and requires explicit platform-managed enablement', () => {
    const input = fixture();
    input.credential.billingMode = 'DOCTOR_BYOK_PAID';
    expect(evaluateAIPolicy(input)).toMatchObject({ reason: 'BILLING_MODE_BLOCKED' });
    input.credential.billingMode = 'PLATFORM_MANAGED';
    expect(evaluateAIPolicy(input).allowed).toBe(false);
    input.platformManagedEnabled = true;
    expect(evaluateAIPolicy(input).allowed).toBe(true);
  });
});

describe('AI fallback selection', () => {
  it('preserves order while skipping failures, unsupported models and weaker protection', () => {
    const disabled = candidate('disabled', 'NO_TRAINING_CONTRACTUAL');
    disabled.input.credential.status = 'DISABLED';
    const unsupported = candidate('unsupported', 'NO_TRAINING_CONTRACTUAL');
    unsupported.modelSupportsTemplate = false;
    const choices = [
      candidate('original', 'NO_TRAINING_CONTRACTUAL'),
      candidate('weaker', 'MAY_TRAIN_OR_REVIEW'),
      disabled,
      unsupported,
      candidate('first', 'NO_TRAINING_CONTRACTUAL'),
      candidate('second', 'NO_TRAINING_CONTRACTUAL'),
    ];
    expect(selectAIFallback(original, choices, 0)?.credentialId).toBe('first');
    expect(selectAIFallback(original, choices, 1)).toBeNull();
  });
  it('allows stronger protection but rejects platform-managed and foreign candidates', () => {
    const platform = candidate('platform', 'NO_TRAINING_CONTRACTUAL');
    platform.input.credential.billingMode = 'PLATFORM_MANAGED';
    const foreign = candidate('foreign', 'NO_TRAINING_CONTRACTUAL');
    foreign.input.tenantId = foreign.input.credential.tenantId = 'foreign-tenant';
    const foreignDoctor = candidate('foreign-doctor', 'NO_TRAINING_CONTRACTUAL');
    foreignDoctor.input.doctorProfileId = foreignDoctor.input.credential.doctorProfileId = 'other';
    const strong = candidate('strong', 'NO_TRAINING_CONTRACTUAL');
    expect(selectAIFallback(original, [platform, foreign, foreignDoctor], 0)).toBeNull();
    expect(
      selectAIFallback(
        { ...original, dataUsePolicy: 'MAY_TRAIN_OR_REVIEW' },
        [platform, foreign, foreignDoctor, strong],
        0,
      )?.credentialId,
    ).toBe('strong');
    strong.input.patientConsentCurrent = false;
    expect(selectAIFallback(original, [strong], 0)).toBeNull();
  });
  it.each([-1, 0.5, NaN, Infinity])('rejects invalid retry counts %s', (count) => {
    expect(selectAIFallback(original, [candidate('next', 'NO_TRAINING_CONTRACTUAL')], count)).toBeNull();
    expect(selectAIFallback(original, [candidate('next', 'NO_TRAINING_CONTRACTUAL')], 0, count)).toBeNull();
  });
});
