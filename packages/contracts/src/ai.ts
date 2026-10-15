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

export const MyAiCredentialList = registry.register(
  'MyAiCredentialList',
  z.object({ doctorProfileId: Uuid, items: z.array(AiCredential) }),
);

registry.registerPath({
  method: 'get',
  path: '/api/v1/me/ai/credentials',
  operationId: 'listMyAiCredentials',
  tags: ['AI'],
  security: secured,
  description:
    'Safe credential metadata belonging to the authenticated active doctor in the selected tenant.',
  request: { headers: tenantHeaders },
  responses: { 200: ok(MyAiCredentialList, 'Own doctor profile and credentials'), ...errorResponses },
});

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

export const AiModel = registry.register(
  'AiModel',
  z.object({
    providerCode: z.string(),
    modelId: z.string().openapi({
      description: "The provider's own identifier, used verbatim. Never constructed by this platform",
    }),
    displayName: z.string(),
    capabilities: z.array(z.string()),
    tierAvailability: z.array(z.enum(['FREE', 'PAID'])),
    contextTokens: z.number().int().nullable(),
    lastVerifiedAt: Timestamp.openapi({
      description: 'When a refresh last saw this model in the provider’s own list',
    }),
    source: z.enum(['PROVIDER_API', 'MANUAL_CONFIG']),
  }),
);

export const AiModelList = registry.register('AiModelList', z.object({ items: z.array(AiModel) }));

registry.registerPath({
  method: 'get',
  path: '/api/v1/ai/models',
  operationId: 'listAiModels',
  tags: ['AI'],
  security: secured,
  description:
    'Live models from the catalog, optionally for one provider. Deprecated models are omitted: a ' +
    'picker that still offered one would be offering a call the provider will refuse.',
  request: {
    headers: tenantHeaders,
    query: z.object({ providerCode: z.string().min(1).max(32).optional() }),
  },
  responses: { 200: ok(AiModelList, 'Models'), ...errorResponses },
});

/**
 * AI jobs (AI-001).
 *
 * A job is the doctor's request, not the answer. It reports the provider, model and data-use class it
 * was permitted to use, because those are what a screen must show beside a draft — a doctor reading a
 * suggestion needs to know whether the provider that produced it may train on what it was sent.
 *
 * `errorClass` is the normalized class from the taxonomy, never a provider's own message: a message
 * can quote the prompt that caused it.
 */
export const AiJob = registry.register(
  'AiJob',
  z.object({
    draftId: Uuid.nullable().openapi({
      description: 'Authorized draft reference when available; null until a draft is persisted',
    }),
    id: Uuid,
    purpose: z.enum(['NOTE_DRAFT', 'HISTORY_SUMMARY', 'TRANSCRIPTION']),
    status: z.enum(['QUEUED', 'RUNNING', 'WAITING_RATE_LIMIT', 'SUCCEEDED', 'FAILED', 'CANCELLED']),
    encounterId: Uuid,
    providerCode: z.string(),
    modelId: z.string(),
    declaredTier: z.enum(['FREE', 'PAID']),
    effectiveDataUsePolicy: z.enum(['MAY_TRAIN_OR_REVIEW', 'NO_TRAINING_CONTRACTUAL']).openapi({
      description: 'Shown beside every suggestion this job produced',
    }),
    promptTemplateVersion: z.string(),
    errorClass: z.string().nullable(),
    errorReason: z.string().nullable().openapi({
      description: 'A rule or category name, never a provider message',
    }),
    cancelRequestedAt: Timestamp.nullable(),
    startedAt: Timestamp.nullable(),
    finishedAt: Timestamp.nullable(),
    rowVersion: z.number().int(),
  }),
);

export const CreateAiJobRequest = registry.register(
  'CreateAiJobRequest',
  z.object({
    credentialId: Uuid.optional().openapi({
      description: 'Defaults to the doctor’s highest-priority active credential',
    }),
    modelId: z.string().min(1).max(128).optional(),
    sourceSelection: z
      .object({
        draftSections: z
          .array(z.enum(['chief_complaint', 'history', 'examination', 'assessment', 'plan']))
          .max(5)
          .optional()
          .openapi({ description: 'Sections of the current draft note the doctor chose to send' }),
        lookbackDays: z.number().int().min(1).max(3650).optional(),
        maxItems: z.number().int().min(1).max(50).optional(),
      })
      .strict(),
    templateVersion: z.string().min(1).max(32).optional(),
  }),
);

const AiJobList = registry.register('AiJobList', z.object({ items: z.array(AiJob) }));
registry.registerPath({
  method: 'get',
  path: '/api/v1/encounters/{id}/ai/jobs',
  operationId: 'listEncounterAiJobs',
  tags: ['AI'],
  security: secured,
  description:
    'The latest 20 jobs for this encounter visible to the requester or their active doctor profile. Reading never queues work.',
  request: { headers: tenantHeaders, params: z.object({ id: Uuid }) },
  responses: { 200: ok(AiJobList, 'Jobs'), ...errorResponses },
});

for (const [path, operationId, description] of [
  [
    '/api/v1/encounters/{id}/ai/note-draft',
    'createAiNoteDraftJob',
    'Queues a note-draft job for this encounter. The response is the job, not the draft: the work ' +
      'happens in the worker, so a request never waits on a vendor.',
  ],
  [
    '/api/v1/encounters/{id}/ai/history-summary',
    'createAiHistorySummaryJob',
    'Queues a history-summary job for this encounter’s patient.',
  ],
] as const) {
  registry.registerPath({
    method: 'post',
    path,
    operationId,
    tags: ['AI'],
    security: secured,
    description,
    request: {
      headers: tenantIdemHeaders,
      params: z.object({ id: Uuid }),
      body: { content: json(CreateAiJobRequest) },
    },
    responses: { 201: ok(AiJob, 'Queued'), ...errorResponses },
  });
}

registry.registerPath({
  method: 'post',
  path: '/api/v1/encounters/{id}/ai/transcription',
  operationId: 'createAiTranscriptionJob',
  tags: ['AI'],
  security: secured,
  description:
    'Always answers FEATURE_DISABLED in MVP. The route exists so a client can tell "not built yet" ' +
    'from "not permitted": transcription would send raw audio, from which identifiers cannot be ' +
    'reliably removed (ADR-017 §3).',
  request: { headers: tenantIdemHeaders, params: z.object({ id: Uuid }) },
  responses: errorResponses,
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/ai/jobs/{id}',
  operationId: 'getAiJob',
  tags: ['AI'],
  security: secured,
  description:
    'The job’s current state. Readable by the doctor who asked and by the encounter’s assigned ' +
    'doctor; nobody else learns that a draft was requested.',
  request: { headers: tenantHeaders, params: z.object({ id: Uuid }) },
  responses: { 200: ok(AiJob, 'Job'), ...errorResponses },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/ai/jobs/{id}/cancel',
  operationId: 'cancelAiJob',
  tags: ['AI'],
  security: secured,
  description:
    'Requests cancellation. A queued or waiting job is cancelled outright; a running one is marked ' +
    'and the runner discards its result rather than claiming to have stopped a call already sent.',
  request: { headers: tenantIdemHeaders, params: z.object({ id: Uuid }) },
  responses: { 200: ok(AiJob, 'Cancelled or cancelling'), ...errorResponses },
});

/**
 * AI drafts and suggestions (AI-002).
 *
 * A draft is a proposal, and this surface is where a doctor reads it and decides. Nothing here writes
 * a clinical record: the one route that does is the approval, which carries its own attestation.
 *
 * Every suggestion reports the sources it rests on, resolved to the records themselves rather than to
 * the model's own labels, so a doctor can check a claim against the chart rather than taking it on
 * trust. `editedCandidate` sits beside the model's own proposal instead of replacing it, so what was
 * proposed stays visible after a doctor revises it.
 */
export const AiSuggestion = registry.register(
  'AiSuggestion',
  z.object({
    id: Uuid,
    suggestionType: z.enum(['NOTE_SECTION', 'DIAGNOSIS', 'HISTORY_ITEM', 'PRESCRIPTION_ITEM', 'FOLLOW_UP']),
    targetSection: z.string().nullable(),
    sourceRefs: z
      .array(
        z.object({
          sourceType: z.string(),
          sourceId: z.string(),
          occurredAt: Timestamp,
        }),
      )
      .openapi({ description: 'Always at least one; a suggestion citing nothing is never stored' }),
    candidate: z.unknown().openapi({ description: 'What the model proposed' }),
    editedCandidate: z.unknown().nullable().openapi({ description: 'What the doctor revised it to' }),
    confidence: z.enum(['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN']),
    status: z.enum(['PENDING', 'ACCEPTED', 'EDITED', 'REJECTED', 'IGNORED', 'APPROVED']),
    reviewedAt: Timestamp.nullable(),
    rowVersion: z.number().int(),
  }),
);

export const AiDraft = registry.register(
  'AiDraft',
  z.object({
    id: Uuid,
    aiJobId: Uuid,
    encounterId: Uuid,
    draftType: z.enum(['NOTE_DRAFT', 'HISTORY_SUMMARY']),
    status: z.enum(['READY_FOR_REVIEW', 'IN_REVIEW', 'CLOSED', 'EXPIRED']),
    outputSchemaVersion: z.string(),
    droppedUnsourcedCount: z.number().int().openapi({
      description: 'Suggestions discarded for citing nothing, so a thin draft is explainable',
    }),
    expiresAt: Timestamp,
    openedAt: Timestamp.nullable(),
    closedAt: Timestamp.nullable(),
    rowVersion: z.number().int(),
    suggestions: z.array(AiSuggestion),
  }),
);

export const ReviewAiSuggestionRequest = registry.register(
  'ReviewAiSuggestionRequest',
  z.object({
    decision: z.enum(['ACCEPT', 'EDIT', 'REJECT', 'IGNORE', 'REOPEN']),
    editedCandidate: z.unknown().optional().openapi({
      description: 'Required for EDIT. Stored beside the model’s proposal, never replacing it',
    }),
    expectedRowVersion: z.number().int(),
  }),
);

registry.registerPath({
  method: 'get',
  path: '/api/v1/ai/drafts/{id}',
  operationId: 'getAiDraft',
  tags: ['AI'],
  security: secured,
  description:
    'The draft with its suggestions and their source references. Readable by the encounter’s doctor ' +
    'or one covering for them.',
  request: { headers: tenantHeaders, params: z.object({ id: Uuid }) },
  responses: { 200: ok(AiDraft, 'Draft'), ...errorResponses },
});

for (const [action, operationId, description] of [
  ['open', 'openAiDraft', 'Marks the draft as being reviewed. Idempotent, and the first open time is kept.'],
  [
    'close',
    'closeAiDraft',
    'Finishes review. Suggestions still pending stay pending: closing says the doctor is done ' +
      'looking, not that they rejected what they never read.',
  ],
] as const) {
  registry.registerPath({
    method: 'post',
    path: `/api/v1/ai/drafts/{id}/${action}`,
    operationId,
    tags: ['AI'],
    security: secured,
    description,
    request: { headers: tenantIdemHeaders, params: z.object({ id: Uuid }) },
    responses: { 200: ok(AiDraft, 'Draft'), ...errorResponses },
  });
}

registry.registerPath({
  method: 'post',
  path: '/api/v1/ai/suggestions/{id}/review',
  operationId: 'reviewAiSuggestion',
  tags: ['AI'],
  security: secured,
  description:
    'Records one decision. `expectedRowVersion` is required: two doctors covering for each other can ' +
    'both have the draft open, and a decision computed from a stale screen would overwrite one they ' +
    'cannot see. A closed or expired draft accepts no decisions.',
  request: {
    headers: tenantIdemHeaders,
    params: z.object({ id: Uuid }),
    body: { content: json(ReviewAiSuggestionRequest) },
  },
  responses: { 200: ok(AiSuggestion, 'Reviewed'), ...errorResponses },
});

/**
 * Approving a suggestion into the chart (AI-003).
 *
 * The only route by which anything a model produced becomes a clinical record. It carries what the
 * doctor saw: the content being approved, the attestation version they were shown, and the row version
 * of both the suggestion and the note draft, so an approval from a stale screen is refused rather than
 * silently overwriting a decision the doctor could not see.
 *
 * `PRESCRIPTION_ITEM` and `FOLLOW_UP` are V1+. They are absent from this enum rather than present and
 * refused, because each would be a different clinical command with its own rules, and offering a
 * target that cannot be executed would be the API promising something it cannot do.
 */
export const ApproveAiSuggestionRequest = registry.register(
  'ApproveAiSuggestionRequest',
  z
    .object({
      approvedTarget: z.enum(['ENCOUNTER_NOTE_SECTION', 'DIAGNOSIS']),
      expectedRowVersion: z.number().int(),
      attestationVersion: z.number().int().min(1),
      noteSection: z
        .object({
          section: z.enum(['chief_complaint', 'history', 'examination', 'assessment', 'plan']),
          mode: z.enum(['APPEND', 'REPLACE']).openapi({
            description: 'APPEND joins what the doctor wrote; REPLACE substitutes the section',
          }),
          text: z.string().min(1).max(20_000),
          expectedNoteRowVersion: z.number().int(),
        })
        .strict()
        .openapi('AiApprovedNoteSection')
        .optional(),
      diagnosis: z
        .object({
          display: z.string().min(1).max(300),
          displayBn: z.string().max(300).nullable().optional(),
          codeSystem: z.string().max(32).nullable().optional(),
          code: z.string().max(32).nullable().optional(),
          certainty: z.enum(['CONFIRMED', 'PROVISIONAL', 'DIFFERENTIAL']),
          clinicalStatus: z.enum(['ACTIVE', 'RESOLVED', 'RULED_OUT']).optional(),
          notes: z.string().max(1000).nullable().optional(),
        })
        .strict()
        .openapi('AiApprovedDiagnosis')
        .optional(),
    })
    .strict(),
);

export const AiApproval = registry.register(
  'AiApproval',
  z.object({
    id: Uuid,
    aiSuggestionId: Uuid,
    approvedTarget: z.enum(['ENCOUNTER_NOTE_SECTION', 'DIAGNOSIS']),
    approvedRecordType: z.string(),
    approvedRecordId: Uuid,
    approvedSection: z.string().nullable(),
    attestationVersion: z.number().int(),
    approvedAt: Timestamp,
  }),
);

registry.registerPath({
  method: 'post',
  path: '/api/v1/ai/suggestions/{id}/approve',
  operationId: 'approveAiSuggestion',
  tags: ['AI'],
  security: secured,
  description:
    'Puts an accepted or edited suggestion into the chart. Needs `ai.approve`, which the authorization ' +
    'matrix gives to doctors only, plus assignment to the encounter. The clinical write, the approval ' +
    'row and the suggestion’s status all commit together: an approval that landed separately from the ' +
    'record it created would leave one existing without the other.',
  request: {
    headers: tenantIdemHeaders,
    params: z.object({ id: Uuid }),
    body: { content: json(ApproveAiSuggestionRequest) },
  },
  responses: { 201: ok(AiApproval, 'Approved'), ...errorResponses },
});

/**
 * AI usage per credential (AICRED-005).
 *
 * A doctor using their own key pays for it, so they can see what has been spent. Every number here is
 * what this system observed on its own provider calls, not a billing record: a vendor's dashboard will
 * differ, and the counts do not try to explain the difference.
 *
 * `estimatedRemaining` is null unless a quota hint was configured for that credential. No provider
 * reports a remaining quota, so the only honest basis is a figure somebody entered — and a number
 * derived from nothing would be read as the provider's own answer.
 */
export const AiCredentialUsage = registry.register(
  'AiCredentialUsage',
  z.object({
    credentialId: Uuid,
    providerCode: z.string(),
    declaredTier: z.enum(['FREE', 'PAID']),
    status: z.string(),
    requestsToday: z.number().int(),
    inputTokensToday: z.number().int().openapi({
      description: 'Provider-reported where available, zero where not. An observation, not a bill',
    }),
    outputTokensToday: z.number().int(),
    requestsThisMinute: z.number().int(),
    lastRateLimitedAt: Timestamp.nullable(),
    retryAfterUntil: Timestamp.nullable().openapi({
      description: 'Set while the provider is still refusing; the runner throttles itself until then',
    }),
    estimatedRemaining: z.number().int().nullable().openapi({
      description: 'Always an estimate, and null unless a quota hint was configured',
    }),
    callsRecorded: z.number().int(),
    errorsRecorded: z.number().int(),
  }),
);

export const AiCredentialUsageList = registry.register(
  'AiCredentialUsageList',
  z.object({ items: z.array(AiCredentialUsage) }),
);

registry.registerPath({
  method: 'get',
  path: '/api/v1/doctors/{doctorId}/ai/usage',
  operationId: 'getAiUsage',
  tags: ['AI'],
  security: secured,
  description:
    'Usage for a doctor’s own credentials. A doctor reads their own without any extra permission; ' +
    'reading a colleague’s needs `ai.usage.read`, because what they spent on their own key is theirs ' +
    'to know.',
  request: { headers: tenantHeaders, params: z.object({ doctorId: Uuid }) },
  responses: { 200: ok(AiCredentialUsageList, 'Usage'), ...errorResponses },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/ai/raw-outputs/{jobId}',
  operationId: 'readAiRawOutput',
  tags: ['AI'],
  security: secured,
  description:
    'Streams the post-minimization request and the raw provider response for one job. Needs ' +
    '`ai.audit.raw_read`, and every read is audited before the bytes are opened. **Not a clinical ' +
    'record**: the response is the model’s unvalidated output, which may contain suggestions the ' +
    'validator discarded. Everything a doctor may act on is in the draft. Answers 404 where the ' +
    'tenant’s retention is zero, since nothing was kept.',
  request: { headers: tenantHeaders, params: z.object({ jobId: Uuid }) },
  responses: {
    200: { description: 'The stored request and response, as JSON bytes' },
    ...errorResponses,
  },
});
