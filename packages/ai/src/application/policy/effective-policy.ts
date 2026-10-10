export type DataUsePolicy = 'MAY_TRAIN_OR_REVIEW' | 'NO_TRAINING_CONTRACTUAL';
export type DeclaredTier = 'FREE' | 'PAID';
export interface AdapterPolicyMetadata {
  providerCode: string;
  tier: DeclaredTier;
  dataUsePolicy: DataUsePolicy | 'UNKNOWN';
  productionGate: 'OPEN' | 'CLOSED';
  productionReviewRecordId?: string;
  capabilities: readonly ('text' | 'json_schema' | 'audio' | 'vision')[];
  usageRestrictions: readonly string[];
}
export interface PolicyCredential {
  id: string;
  tenantId: string;
  doctorProfileId: string;
  providerCode: string;
  declaredTier: DeclaredTier;
  status: string;
  billingMode: 'DOCTOR_BYOK_FREE' | 'DOCTOR_BYOK_PAID' | 'PLATFORM_MANAGED';
}
/** Trusted, live snapshots must be resolved again before each provider call. */
export interface AIPolicyInput {
  environment: 'development' | 'test' | 'staging' | 'production';
  tenantId: string;
  doctorProfileId: string;
  tenant: {
    aiEnabled: boolean;
    freeTierAiAllowed: boolean;
    minimizationRequiredForNoTraining: boolean;
    allowedProviderCodes: readonly string[];
  };
  enabledProviderCodes: readonly string[];
  credential: PolicyCredential;
  metadata: AdapterPolicyMetadata | null;
  assignedDoctor: boolean;
  patientConsentCurrent: boolean;
  acknowledgementCurrent: boolean;
  freeTierProductionGateClosed: boolean;
  rawMediaFeatureEnabled: boolean;
  syntheticData: boolean;
  platformManagedEnabled?: boolean;
}
export type PolicyBlockReason =
  | 'AI_DISABLED'
  | 'CREDENTIAL_SCOPE'
  | 'CREDENTIAL_INACTIVE'
  | 'BILLING_MODE_BLOCKED'
  | 'DOCTOR_NOT_ASSIGNED'
  | 'CONSENT_REQUIRED'
  | 'METADATA_MISSING_OR_MISMATCHED'
  | 'PROVIDER_NOT_ALLOWED'
  | 'SYNTHETIC_DATA_ONLY'
  | 'PRODUCTION_REVIEW_REQUIRED'
  | 'FREE_TIER_BLOCKED'
  | 'ACK_REQUIRED';
export type AIPolicyDecision =
  | { allowed: false; reason: PolicyBlockReason }
  | {
      allowed: true;
      dataUsePolicy: DataUsePolicy;
      requireMinimization: boolean;
      allowRawMedia: boolean;
      usageRestrictions: readonly string[];
    };

/** Pure authorization policy; never activates a credential or writes clinical data. */
export function evaluateAIPolicy(input: AIPolicyInput): AIPolicyDecision {
  const deny = (reason: PolicyBlockReason): AIPolicyDecision => ({ allowed: false, reason });
  const { tenant, credential, metadata } = input;
  if (tenant.aiEnabled !== true) return deny('AI_DISABLED');
  if (
    !input.tenantId ||
    !input.doctorProfileId ||
    credential.tenantId !== input.tenantId ||
    credential.doctorProfileId !== input.doctorProfileId
  )
    return deny('CREDENTIAL_SCOPE');
  if (credential.status !== 'ACTIVE') return deny('CREDENTIAL_INACTIVE');
  if (!(
    (credential.billingMode === 'DOCTOR_BYOK_FREE' && credential.declaredTier === 'FREE') ||
    (credential.billingMode === 'DOCTOR_BYOK_PAID' && credential.declaredTier === 'PAID') ||
    (credential.billingMode === 'PLATFORM_MANAGED' && input.platformManagedEnabled === true)
  ))
    return deny('BILLING_MODE_BLOCKED');
  if (input.assignedDoctor !== true) return deny('DOCTOR_NOT_ASSIGNED');
  if (input.patientConsentCurrent !== true) return deny('CONSENT_REQUIRED');
  if (
    !metadata ||
    metadata.providerCode !== credential.providerCode ||
    metadata.tier !== credential.declaredTier
  )
    return deny('METADATA_MISSING_OR_MISMATCHED');
  if (
    !tenant.allowedProviderCodes.includes(credential.providerCode) ||
    !input.enabledProviderCodes.includes(credential.providerCode)
  )
    return deny('PROVIDER_NOT_ALLOWED');
  if (metadata.usageRestrictions.includes('SYNTHETIC_DATA_ONLY') && input.syntheticData !== true)
    return deny('SYNTHETIC_DATA_ONLY');
  if (
    input.environment === 'production' &&
    (credential.providerCode === 'mock' ||
      metadata.productionGate !== 'CLOSED' ||
      !metadata.productionReviewRecordId?.trim())
  )
    return deny('PRODUCTION_REVIEW_REQUIRED');
  // UNKNOWN (and unexpected runtime values) always take the more restrictive path.
  const dataUsePolicy =
    metadata.dataUsePolicy === 'NO_TRAINING_CONTRACTUAL' ? 'NO_TRAINING_CONTRACTUAL' : 'MAY_TRAIN_OR_REVIEW';
  if (dataUsePolicy === 'MAY_TRAIN_OR_REVIEW') {
    if (
      tenant.freeTierAiAllowed !== true ||
      (input.environment === 'production' && input.freeTierProductionGateClosed !== true)
    )
      return deny('FREE_TIER_BLOCKED');
    if (input.acknowledgementCurrent !== true) return deny('ACK_REQUIRED');
  }
  return {
    allowed: true,
    dataUsePolicy,
    requireMinimization:
      dataUsePolicy === 'MAY_TRAIN_OR_REVIEW' || tenant.minimizationRequiredForNoTraining !== false,
    allowRawMedia:
      dataUsePolicy === 'NO_TRAINING_CONTRACTUAL' &&
      input.rawMediaFeatureEnabled === true &&
      (metadata.capabilities.includes('audio') || metadata.capabilities.includes('vision')),
    usageRestrictions: [...metadata.usageRestrictions],
  };
}

export interface FallbackCandidate {
  input: AIPolicyInput;
  modelSupportsTemplate: boolean;
}
/** Caller supplies the doctor's explicit order; selection never weakens policy. */
export function selectAIFallback(
  original: {
    credentialId: string;
    tenantId: string;
    doctorProfileId: string;
    dataUsePolicy: DataUsePolicy;
  },
  candidates: readonly FallbackCandidate[],
  fallbacksUsed: number,
  maxFallbacks = 1,
): { credentialId: string; policy: Extract<AIPolicyDecision, { allowed: true }> } | null {
  if (
    !Number.isSafeInteger(fallbacksUsed) ||
    !Number.isSafeInteger(maxFallbacks) ||
    fallbacksUsed < 0 ||
    maxFallbacks < 0 ||
    fallbacksUsed >= maxFallbacks ||
    !['NO_TRAINING_CONTRACTUAL', 'MAY_TRAIN_OR_REVIEW'].includes(original.dataUsePolicy)
  )
    return null;
  for (const candidate of candidates) {
    const { credential } = candidate.input;
    if (
      !credential.id ||
      candidate.input.tenantId !== original.tenantId ||
      candidate.input.doctorProfileId !== original.doctorProfileId ||
      credential.id === original.credentialId ||
      !['DOCTOR_BYOK_FREE', 'DOCTOR_BYOK_PAID'].includes(credential.billingMode) ||
      candidate.modelSupportsTemplate !== true
    )
      continue;
    const policy = evaluateAIPolicy(candidate.input);
    if (!policy.allowed) continue;
    if (
      original.dataUsePolicy === 'NO_TRAINING_CONTRACTUAL' &&
      policy.dataUsePolicy !== 'NO_TRAINING_CONTRACTUAL'
    )
      continue;
    return { credentialId: credential.id, policy };
  }
  return null;
}
