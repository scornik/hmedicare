import { bearerAuth, registry, z } from './registry';
import { IdempotencyKeyHeader, TenantIdHeader, Timestamp, Uuid, envelope, errorResponses } from './common';

/**
 * AI policy, acknowledgements and credentials (AICRED-003, AIPOL-001/002, ADR-017).
 *
 * Three rules shape this surface.
 *
 * **No secret ever appears in a response.** A credential is written once and thereafter described by
 * its last four characters and its status. There is no read route that returns a key, because a route
 * that could would eventually be called by something that logs its responses.
 *
 * **The tenant policy reports its stored value and its effective one separately.** While the free-tier
 * research gate is open (ADR-017 §3) the engine forces free-tier use off regardless of what the tenant
 * chose, so a screen needs both numbers to avoid showing one and meaning the other.
 *
 * **An acknowledgement carries the hash of the text that was read.** The words live in the AI context's
 * registry; the hash is what ties a doctor's statement to them after the text moves on.
 */
const secured = [{ [bearerAuth.name]: [] }];
const tenantHeaders = z.object({ 'X-Tenant-ID': TenantIdHeader });
const tenantIdemHeaders = z.object({
  'X-Tenant-ID': TenantIdHeader,
  'Idempotency-Key': IdempotencyKeyHeader,
});
const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });
const ok = <T extends z.ZodTypeAny>(schema: T, description: string) => ({
  description,
  content: json(envelope(schema)),
});

const PolicySnapshot = z.object({
  aiEnabled: z.boolean(),
  freeTierAiAllowed: z.boolean(),
  minimizationRequiredForNoTraining: z.boolean(),
  rawOutputRetentionDays: z.number().int(),
  allowedProviderCodes: z.array(z.string()),
  minAiConsentPolicyVersion: z.number().int(),
  policyTextVersion: z.string(),
});

export const TenantAiPolicy = registry.register(
  'TenantAiPolicy',
  PolicySnapshot.extend({
    policyVersion: z.number().int(),
    rowVersion: z.number().int(),
    decidedByUserId: Uuid.nullable(),
    decidedAt: Timestamp.nullable(),
    freeTierEffective: z.boolean().openapi({
      description: 'What the policy engine applies; false while the production research gate is open',
    }),
    freeTierForcedOffByProductionGate: z.boolean().openapi({
      description: 'True when the stored choice is being overridden, so a screen can explain itself',
    }),
  }),
);

export const TenantAiPolicyDecision = registry.register(
  'TenantAiPolicyDecision',
  PolicySnapshot.extend({
    reason: z.string().trim().min(1).max(500).openapi({
      description: 'Why, in the owner’s words. Recorded in the policy event and never defaulted',
    }),
    expectedRowVersion: z.number().int().optional(),
  }),
);

export const TenantAiPolicyEventList = registry.register(
  'TenantAiPolicyEventList',
  z.object({
    items: z.array(
      z.object({
        seq: z.number().int(),
        policyVersion: z.number().int(),
        before: PolicySnapshot,
        after: PolicySnapshot,
        policyTextVersion: z.string(),
        reason: z.string(),
        actorUserId: Uuid,
        occurredAt: Timestamp,
      }),
    ),
  }),
);

export const AiAcknowledgementText = registry.register(
  'AiAcknowledgementText',
  z.object({
    version: z.string(),
    tier: z.enum(['FREE', 'PAID']),
    locale: z.enum(['bn-BD', 'en-BD']),
    body: z.string(),
    sha256: z.string().length(64),
  }),
);

export const AiAcknowledgementTextList = registry.register(
  'AiAcknowledgementTextList',
  z.object({ items: z.array(AiAcknowledgementText) }),
);

export const AiAcknowledgement = registry.register(
  'AiAcknowledgement',
  z.object({
    id: Uuid,
    doctorProfileId: Uuid,
    providerCode: z.string(),
    tier: z.enum(['FREE', 'PAID']),
    termsTextVersion: z.string(),
    termsTextSha256: z.string().length(64),
    acknowledgedByUserId: Uuid,
    acknowledgedAt: Timestamp,
    revokedAt: Timestamp.nullable(),
    revokeReason: z.string().nullable(),
    rowVersion: z.number().int(),
  }),
);

export const AiAcknowledgementList = registry.register(
  'AiAcknowledgementList',
  z.object({ items: z.array(AiAcknowledgement) }),
);

export const RecordAiAcknowledgementRequest = registry.register(
  'RecordAiAcknowledgementRequest',
  z.object({
    doctorProfileId: Uuid,
    providerCode: z.string().min(1).max(32),
    tier: z.enum(['FREE', 'PAID']),
    locale: z.enum(['bn-BD', 'en-BD']),
    termsTextVersion: z.string().min(1).max(32).openapi({
      description: 'The version the screen displayed; a superseded version is refused',
    }),
  }),
);

export const AiCredential = registry.register(
  'AiCredential',
  z.object({
    id: Uuid,
    doctorProfileId: Uuid,
    providerCode: z.string(),
    declaredTier: z.enum(['FREE', 'PAID']),
    billingMode: z.enum(['DOCTOR_BYOK_FREE', 'DOCTOR_BYOK_PAID', 'PLATFORM_MANAGED']),
    status: z.enum(['PENDING_VALIDATION', 'ACTIVE', 'INVALID', 'QUOTA_EXHAUSTED', 'DISABLED', 'REVOKED']),
    secretLast4: z.string().nullable().openapi({
      description: 'All a response ever carries of the key itself',
    }),
    validatedAt: Timestamp.nullable(),
    lastErrorClass: z.string().nullable(),
    rowVersion: z.number().int(),
  }),
);

export const AiCredentialList = registry.register(
  'AiCredentialList',
  z.object({ items: z.array(AiCredential) }),
);

export const CreateAiCredentialRequest = registry.register(
  'CreateAiCredentialRequest',
  z.object({
    providerCode: z.string().min(1).max(32),
    declaredTier: z.enum(['FREE', 'PAID']),
    billingMode: z.enum(['DOCTOR_BYOK_FREE', 'DOCTOR_BYOK_PAID', 'PLATFORM_MANAGED']),
    secret: z.string().min(16).max(512).openapi({
      description: 'Write-only. Sealed on arrival and never returned by any route',
    }),
    dataUseAckId: Uuid.optional().openapi({
      description:
        'The live acknowledgement permitting this credential. Revoking it returns the credential to PENDING_VALIDATION',
    }),
  }),
);

export const ChangeAiCredentialRequest = registry.register(
  'ChangeAiCredentialRequest',
  z.object({
    action: z.enum(['DISABLE', 'ENABLE', 'REVALIDATE', 'REVOKE']),
    expectedRowVersion: z.number().int(),
  }),
);

registry.registerPath({
  method: 'get',
  path: '/api/v1/tenant/ai-policy',
  operationId: 'getTenantAiPolicy',
  tags: ['AI'],
  security: secured,
  description:
    'The tenant AI policy, or the defaults when it has never decided. Carries both the stored ' +
    'free-tier choice and the effective one.',
  request: { headers: tenantHeaders },
  responses: { 200: ok(TenantAiPolicy, 'Policy'), ...errorResponses },
});

registry.registerPath({
  method: 'put',
  path: '/api/v1/tenant/ai-policy',
  operationId: 'decideTenantAiPolicy',
  tags: ['AI'],
  security: secured,
  description:
    'Records a policy decision and appends its hash-chained event. Tenant owners only ' +
    '(ai.policy.manage). A reason is required and is never defaulted.',
  request: { headers: tenantIdemHeaders, body: { content: json(TenantAiPolicyDecision) } },
  responses: { 200: ok(TenantAiPolicy, 'Decided'), ...errorResponses },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/tenant/ai-policy/events',
  operationId: 'listTenantAiPolicyEvents',
  tags: ['AI'],
  security: secured,
  description: 'The decision history, newest first, as recorded on the verified chain.',
  request: {
    headers: tenantHeaders,
    query: z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }),
  },
  responses: { 200: ok(TenantAiPolicyEventList, 'Events'), ...errorResponses },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/ai/acknowledgement-texts',
  operationId: 'listAiAcknowledgementTexts',
  tags: ['AI'],
  security: secured,
  description:
    'The acknowledgement texts in force, with their hashes, for a screen that has to display one ' +
    'before a doctor agrees to it.',
  request: { headers: tenantHeaders },
  responses: { 200: ok(AiAcknowledgementTextList, 'Texts'), ...errorResponses },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/ai/acknowledgements',
  operationId: 'recordAiAcknowledgement',
  tags: ['AI'],
  security: secured,
  description:
    'Records a doctor’s data-use acknowledgement of the current text. Idempotent for the same ' +
    'doctor, provider, tier and version.',
  request: { headers: tenantIdemHeaders, body: { content: json(RecordAiAcknowledgementRequest) } },
  responses: { 201: ok(AiAcknowledgement, 'Acknowledged'), ...errorResponses },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/doctors/{id}/ai/acknowledgements',
  operationId: 'listAiAcknowledgements',
  tags: ['AI'],
  security: secured,
  description: 'A doctor’s acknowledgements, including revoked ones, newest first.',
  request: { headers: tenantHeaders, params: z.object({ id: Uuid }) },
  responses: { 200: ok(AiAcknowledgementList, 'Acknowledgements'), ...errorResponses },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/ai/acknowledgements/{id}/withdraw',
  operationId: 'withdrawAiAcknowledgement',
  tags: ['AI'],
  security: secured,
  description:
    'Withdraws an acknowledgement without deleting the record of it, and returns every credential ' +
    'that depended on it to PENDING_VALIDATION.',
  request: { headers: tenantIdemHeaders, params: z.object({ id: Uuid }) },
  responses: { 200: ok(AiAcknowledgement, 'Withdrawn'), ...errorResponses },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/doctors/{id}/ai/credentials',
  operationId: 'listAiCredentials',
  tags: ['AI'],
  security: secured,
  description: 'A doctor’s AI credentials as safe metadata. No route returns the key itself.',
  request: { headers: tenantHeaders, params: z.object({ id: Uuid }) },
  responses: { 200: ok(AiCredentialList, 'Credentials'), ...errorResponses },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/doctors/{id}/ai/credentials',
  operationId: 'createAiCredential',
  tags: ['AI'],
  security: secured,
  description:
    'Stores a provider key for a doctor, sealed on arrival, as PENDING_VALIDATION. A doctor acts for ' +
    'themselves; anyone else needs ai.credentials.manage.',
  request: {
    headers: tenantIdemHeaders,
    params: z.object({ id: Uuid }),
    body: { content: json(CreateAiCredentialRequest) },
  },
  responses: { 201: ok(AiCredential, 'Created'), ...errorResponses },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/doctors/{doctorId}/ai/credentials/{id}/actions',
  operationId: 'changeAiCredential',
  tags: ['AI'],
  security: secured,
  description:
    'Disables, re-enables, requests revalidation of or revokes a credential. Revocation is terminal ' +
    'and replaces the stored secret with a tombstone, so the same key may later be added again.',
  request: {
    headers: tenantIdemHeaders,
    params: z.object({ doctorId: Uuid, id: Uuid }),
    body: { content: json(ChangeAiCredentialRequest) },
  },
  responses: { 200: ok(AiCredential, 'Changed'), ...errorResponses },
});
