import { IdempotencyKeyHeader, TenantIdHeader, Timestamp, Uuid, envelope, errorResponses } from './common';
import { CareMode } from './scheduling';
import { bearerAuth, registry, z } from './registry';

// API-IMPLEMENTATION §3.7 (encounters). The clinical lifecycle: a called serial becomes a consultation,
// and a consultation becomes a record. Stage 6 CLIN-002.

export const EncounterStatus = z.enum(['IN_PROGRESS', 'INTERRUPTED', 'COMPLETED', 'ENTERED_IN_ERROR']);

export const Encounter = registry.register(
  'Encounter',
  z.object({
    id: Uuid,
    patientId: Uuid,
    doctorProfileId: Uuid,
    chamberId: Uuid,
    serialId: Uuid,
    appointmentId: Uuid.nullable(),
    coveringDoctorProfileId: Uuid.nullable().openapi({
      description: 'Set when a covering doctor acted, with the grant recorded alongside it',
    }),
    careMode: CareMode,
    status: EncounterStatus,
    legacyInterim: z.boolean().openapi({
      description:
        'Backfilled from a Stage 5 interim transition (ADR-021). Carries no note, because none was written',
    }),
    startedAt: Timestamp,
    interruptedAt: Timestamp.nullable(),
    resumedAt: Timestamp.nullable(),
    completedAt: Timestamp.nullable(),
    rowVersion: z.number().int(),
  }),
);

export const StartEncounterRequest = registry.register(
  'StartEncounterRequest',
  z.object({
    expectedRowVersion: z.number().int().min(1).openapi({
      description: "The serial's row version, so a stale board cannot start a consultation twice",
    }),
  }),
);

export const RowVersionOnly = z.object({ expectedRowVersion: z.number().int().min(1) });

export const InterruptEncounterRequest = registry.register(
  'InterruptEncounterRequest',
  z.object({
    expectedRowVersion: z.number().int().min(1),
    reason: z.string().trim().min(3).max(300),
  }),
);

export const EnterEncounterInErrorRequest = registry.register(
  'EnterEncounterInErrorRequest',
  z.object({
    expectedRowVersion: z.number().int().min(1),
    reason: z.string().trim().min(3).max(300).openapi({
      description: 'Required. The row is kept for the audit trail, so the reason is the record',
    }),
  }),
);

// ---------------------------------------------------------------- paths

const idParam = z.object({ id: Uuid });
const json = (schema: z.ZodTypeAny) => ({ 'application/json': { schema } });
const secured = [{ [bearerAuth.name]: [] }];
const tenantHeaders = z.object({ 'X-Tenant-ID': TenantIdHeader });
const tenantIdemHeaders = z.object({
  'X-Tenant-ID': TenantIdHeader,
  'Idempotency-Key': IdempotencyKeyHeader,
});
const ok = (schema: z.ZodTypeAny, description: string) => ({ description, content: json(envelope(schema)) });

registry.registerPath({
  method: 'post',
  path: '/api/v1/serials/{id}/encounter',
  operationId: 'startEncounter',
  tags: ['encounters'],
  security: secured,
  request: {
    headers: tenantIdemHeaders,
    params: idParam,
    body: { content: json(StartEncounterRequest) },
  },
  responses: {
    201: ok(
      Encounter,
      'Consultation started (`encounter.start`, assigned or covering doctor). The serial moves to ' +
        'IN_CONSULTATION in the same transaction and an empty note draft is created. ' +
        '409 when another encounter already holds the serial; INVALID_TRANSITION when the serial is not ' +
        'waiting to be seen',
    ),
    ...errorResponses,
  },
});

/** The history panel asks for a page of the patient's consultations, minus the one already on screen. */
export const ListPatientEncountersQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  excludeEncounterId: Uuid.optional(),
});

export const EncounterSummary = registry.register(
  'EncounterSummary',
  z.object({
    id: Uuid,
    startedAt: Timestamp,
    completedAt: Timestamp.nullable(),
    status: EncounterStatus,
    doctorProfileId: Uuid,
    chamberId: Uuid,
    careMode: CareMode,
    legacyInterim: z.boolean(),
    signedRevisions: z.number().int().min(0).openapi({
      description: '0 when nothing was ever signed: an abandoned consultation, or a legacy ADR-021 row',
    }),
  }),
);

registry.registerPath({
  method: 'get',
  path: '/api/v1/patients/{id}/encounters',
  operationId: 'listPatientEncounters',
  tags: ['encounters'],
  security: secured,
  request: {
    headers: tenantHeaders,
    params: idParam,
    query: ListPatientEncountersQuery,
  },
  responses: {
    200: ok(
      z.array(EncounterSummary),
      "The patient's consultations, newest first (`encounter.read` + assignment to the **patient**). " +
        'A doctor treating this patient needs to see the last visit even when another doctor ran it; ' +
        'signing and amending stay at encounter level. Carries no note text — open a revision to read one, ' +
        'which is audited separately',
    ),
    ...errorResponses,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/encounters/{id}',
  operationId: 'getEncounter',
  tags: ['encounters'],
  security: secured,
  request: { headers: tenantHeaders, params: idParam },
  responses: {
    200: ok(Encounter, 'The encounter (assigned or covering doctor; `encounter.read`)'),
    ...errorResponses,
  },
});

for (const [action, operationId, body, description] of [
  [
    'interrupt',
    'interruptEncounter',
    InterruptEncounterRequest,
    'IN_PROGRESS → INTERRUPTED (`encounter.manage` + assignment). The serial stays IN_CONSULTATION: the ' +
      'patient still holds the room',
  ],
  [
    'resume',
    'resumeEncounter',
    RowVersionOnly,
    'INTERRUPTED → IN_PROGRESS (`encounter.manage` + assignment)',
  ],
  [
    'complete',
    'completeEncounter',
    RowVersionOnly,
    'IN_PROGRESS/INTERRUPTED → COMPLETED (`encounter.complete` + assignment). The serial completes in the ' +
      'same transaction',
  ],
  [
    'entered-in-error',
    'enterEncounterInError',
    EnterEncounterInErrorRequest,
    'Voids an encounter recorded in error (`encounter.manage` + assignment). The only exit from COMPLETED. ' +
      'The row is kept and the serial is freed for a correct encounter',
  ],
] as const) {
  registry.registerPath({
    method: 'post',
    path: `/api/v1/encounters/{id}/${action}`,
    operationId,
    tags: ['encounters'],
    security: secured,
    request: { headers: tenantIdemHeaders, params: idParam, body: { content: json(body) } },
    responses: { 200: ok(Encounter, description), ...errorResponses },
  });
}
