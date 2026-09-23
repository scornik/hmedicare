import { IdempotencyKeyHeader, TenantIdHeader, Timestamp, Uuid, envelope, errorResponses } from './common';
import { LocalDate } from './patient';
import { bearerAuth, registry, z } from './registry';
import { CancelReason, CareMode, ChamberDayStatus, RowVersionOnlyRequest } from './scheduling';

// API-IMPLEMENTATION §3.6 (serials and the live queue). The serial lifecycle is QUEUE §5.4; the staff
// snapshot is QUEUE §3.5 and the patient view QUEUE §4.2.

export const SerialStatus = z.enum([
  'BOOKED',
  'CONFIRMED',
  'CHECKED_IN',
  'WAITING',
  'CALLED',
  'IN_CONSULTATION',
  'COMPLETED',
  'SKIPPED',
  'NO_SHOW',
  'CANCELLED',
  'RESCHEDULED',
]);
export const SerialSource = z.enum(['ADVANCE_BOOKING', 'WALK_IN', 'FOLLOW_UP']);
export const CheckInMethod = z.enum(['STAFF_DESK', 'PATIENT_APP', 'REMOTE_READY', 'KIOSK']);

export const Serial = registry.register(
  'Serial',
  z.object({
    id: Uuid,
    chamberDayId: Uuid,
    patientId: Uuid,
    appointmentId: Uuid.nullable(),
    serialNumber: z.number().int().min(1),
    queuePosition: z.number().int().min(1).nullable(),
    source: SerialSource,
    careMode: CareMode,
    status: SerialStatus,
    recallCount: z.number().int().min(0),
    recallDeadlineAt: Timestamp.nullable(),
    lateArrival: z.boolean(),
    duplicateOverride: z.boolean(),
    rescheduledFromSerialId: Uuid.nullable(),
    rescheduledToSerialId: Uuid.nullable(),
    cancelReason: CancelReason.nullable(),
    bookedAt: Timestamp.nullable(),
    confirmedAt: Timestamp.nullable(),
    checkedInAt: Timestamp.nullable(),
    calledAt: Timestamp.nullable(),
    completedAt: Timestamp.nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    rowVersion: z.number().int(),
  }),
);

/**
 * One row of the staff queue board. Patient identity is limited to the display name and MRN, which the
 * staff caller already holds through `patient.read`; no contact details ever appear here.
 */
export const QueueEntry = registry.register(
  'QueueEntry',
  z.object({
    serialId: Uuid,
    serialNumber: z.number().int().min(1),
    queuePosition: z.number().int().min(1).nullable(),
    status: SerialStatus,
    careMode: CareMode,
    source: SerialSource,
    patientId: Uuid,
    patientDisplayName: z.string(),
    medicalRecordNumber: z.string(),
    lateArrival: z.boolean(),
    recallCount: z.number().int().min(0),
    recallDeadlineAt: Timestamp.nullable(),
    remoteReady: z.boolean(),
    duplicateOverride: z.boolean(),
    encounterId: Uuid.nullable().openapi({
      description:
        'The consultation started from this serial, once there is one. The board follows it to ' +
        '`/encounters/{id}` rather than acting on the serial itself',
    }),
    rowVersion: z.number().int(),
  }),
);

export const QueueSnapshot = registry.register(
  'QueueSnapshot',
  z.object({
    chamberDayId: Uuid,
    localDate: LocalDate,
    status: ChamberDayStatus,
    queueOrderVersion: z.number().int(),
    expectedDelayMinutes: z.number().int().nullable(),
    avgConsultationMinutes: z.number().int(),
    counts: z.object({
      waiting: z.number().int().min(0),
      called: z.number().int().min(0),
      inConsultation: z.number().int().min(0),
      completed: z.number().int().min(0),
      totalSerials: z.number().int().min(0),
    }),
    entries: z.array(QueueEntry),
    asOf: Timestamp,
    etag: z.string().openapi({ description: 'Strong ETag over the snapshot body (QUEUE §3.5 polling)' }),
  }),
);

/**
 * The patient's own view of their serial (QUEUE §4.2): never another patient's identity, and every waiting
 * figure is labelled an estimate rather than a promise.
 */
export const PatientSerialView = registry.register(
  'PatientSerialView',
  z.object({
    serialId: Uuid,
    serialNumber: z.number().int().min(1),
    status: SerialStatus,
    chamberDayId: Uuid,
    localDate: LocalDate,
    dayStatus: ChamberDayStatus,
    careMode: CareMode,
    peopleAhead: z.number().int().min(0).nullable().openapi({
      description: 'Live count ahead in the queue, once the patient has arrived',
    }),
    estimatedPosition: z.number().int().min(1).nullable().openapi({
      description: 'Estimate before arrival; not a queue position',
    }),
    estimatedWaitMinutes: z.number().int().min(0).nullable(),
    expectedDelayMinutes: z.number().int().nullable(),
    recallDeadlineAt: Timestamp.nullable(),
    recallsRemaining: z.number().int().min(0).nullable(),
    asOf: Timestamp,
    rowVersion: z.number().int().openapi({
      description: 'Send this back with a command on this serial (confirm, check-in, cancel, remote-ready)',
    }),
  }),
);

export const IssueWalkInRequest = registry.register(
  'IssueWalkInRequest',
  z.object({
    patientId: Uuid,
    careMode: CareMode,
    duplicateOverride: z
      .object({ reason: z.string().trim().min(3).max(300) })
      .nullable()
      .optional()
      .openapi({ description: 'Issues a second active serial for the patient; role-gated by policy' }),
  }),
);
export const CheckInRequest = registry.register(
  'CheckInRequest',
  z.object({ expectedRowVersion: z.number().int().min(1), method: CheckInMethod.optional() }),
);
export const CallSerialRequest = registry.register(
  'CallSerialRequest',
  z.object({
    expectedRowVersion: z.number().int().min(1),
    overrideReason: z.string().trim().min(3).max(300).nullable().optional(),
  }),
);
export const SkipSerialRequest = registry.register(
  'SkipSerialRequest',
  z.object({ expectedRowVersion: z.number().int().min(1), reason: z.string().trim().min(3).max(300) }),
);
export const CancelSerialRequest = registry.register(
  'CancelSerialRequest',
  z.object({ expectedRowVersion: z.number().int().min(1), reason: CancelReason }),
);
export const RescheduleSerialRequest = registry.register(
  'RescheduleSerialRequest',
  z.object({
    expectedRowVersion: z.number().int().min(1),
    targetChamberDayId: Uuid,
    targetSlotId: Uuid.nullable().optional(),
    reason: z.string().trim().max(300).nullable().optional(),
  }),
);
export const RescheduleSerialResponse = registry.register(
  'RescheduleSerialResponse',
  z.object({ old: Serial, next: Serial }),
);
export const ReorderQueueRequest = registry.register(
  'ReorderQueueRequest',
  z.object({
    expectedQueueOrderVersion: z.number().int().min(0),
    orderedSerialIds: z.array(Uuid).min(1).max(500).openapi({
      description:
        'The serials to reposition, in the desired order. It need not list every active serial: the multiset of their current positions is reassigned in this order and the others keep theirs (QUEUE §5.3)',
    }),
  }),
);
export const SerialListResponse = registry.register(
  'SerialListResponse',
  z.object({ items: z.array(PatientSerialView) }),
);

// ---------------------------------------------------------------- paths

const json = (schema: z.ZodTypeAny) => ({ 'application/json': { schema } });
const secured = [{ [bearerAuth.name]: [] }];
const PatientContextHeader = Uuid.openapi({ param: { name: 'X-Patient-Context', in: 'header' } });
const tenantHeaders = z.object({ 'X-Tenant-ID': TenantIdHeader });
const tenantIdemHeaders = z.object({
  'X-Tenant-ID': TenantIdHeader,
  'Idempotency-Key': IdempotencyKeyHeader,
});
const tenantOrPatientIdemHeaders = z.object({
  'X-Tenant-ID': TenantIdHeader,
  'X-Patient-Context': PatientContextHeader.optional(),
  'Idempotency-Key': IdempotencyKeyHeader,
});
const patientHeaders = z.object({
  'X-Tenant-ID': TenantIdHeader,
  'X-Patient-Context': PatientContextHeader,
});
const ok = (schema: z.ZodTypeAny, description: string) => ({ description, content: json(envelope(schema)) });
const idParam = z.object({ id: Uuid });

// The live queue of one chamber day (API-IMPLEMENTATION §3.5).
registry.registerPath({
  method: 'get',
  path: '/api/v1/chamber-days/{id}/queue',
  operationId: 'getQueue',
  tags: ['queue'],
  security: secured,
  request: {
    headers: tenantHeaders.extend({
      'If-None-Match': z
        .string()
        .optional()
        .openapi({ param: { name: 'If-None-Match', in: 'header' }, example: '"a1b2c3"' }),
    }),
    params: idParam,
  },
  responses: {
    200: ok(QueueSnapshot, 'The live queue board (`queue.read`). Poll with If-None-Match against `etag`'),
    304: { description: 'The board is unchanged since that ETag; no body (ADR-013 polling)' },
    ...errorResponses,
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/chamber-days/{id}/walk-ins',
  operationId: 'issueWalkInSerial',
  tags: ['queue'],
  security: secured,
  request: { headers: tenantIdemHeaders, params: idParam, body: { content: json(IssueWalkInRequest) } },
  responses: {
    201: ok(
      Serial,
      'Walk-in serial issued and checked in (`serial.write`). DUPLICATE_ACTIVE_SERIAL unless overridden; QUEUE_STATE_CONFLICT when the day is not open; CAPACITY_EXCEEDED at the walk-in cap',
    ),
    ...errorResponses,
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/chamber-days/{id}/reorder',
  operationId: 'reorderQueue',
  tags: ['queue'],
  security: secured,
  request: { headers: tenantIdemHeaders, params: idParam, body: { content: json(ReorderQueueRequest) } },
  responses: {
    200: ok(
      QueueSnapshot,
      'Queue reordered under the recorded reason (`queue.manage`). STALE_VERSION when expectedQueueOrderVersion no longer matches',
    ),
    ...errorResponses,
  },
});

// One serial. GetSerial answers the staff row, or the patient view when a patient context is supplied.
registry.registerPath({
  method: 'get',
  path: '/api/v1/serials/{id}',
  operationId: 'getSerial',
  tags: ['serials'],
  security: secured,
  request: { headers: tenantHeaders, params: idParam },
  responses: { 200: ok(Serial, 'The staff row (`queue.read`)'), ...errorResponses },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/me/serials/{id}',
  operationId: 'getMySerial',
  tags: ['serials'],
  security: secured,
  request: { headers: patientHeaders, params: idParam },
  responses: {
    200: ok(PatientSerialView, 'The patient’s own view of one serial; waiting figures are estimates'),
    ...errorResponses,
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/me/serials',
  operationId: 'listMySerials',
  tags: ['serials'],
  security: secured,
  request: {
    headers: patientHeaders,
    query: z.object({ limit: z.coerce.number().int().min(1).max(50).optional() }),
  },
  responses: { 200: ok(SerialListResponse, 'The context patient’s recent serials'), ...errorResponses },
});

/**
 * Transitions that take nothing but `expectedRowVersion`. An edge the transition table does not allow is
 * INVALID_TRANSITION, never a silent no-op; a repeat under the same Idempotency-Key replays the first answer.
 */
for (const [action, operationId, headers, description] of [
  [
    'confirm',
    'confirmSerial',
    tenantOrPatientIdemHeaders,
    'BOOKED → CONFIRMED (`serial.manage`, or the patient in context)',
  ],
  ['mark-waiting', 'markWaiting', tenantIdemHeaders, 'CHECKED_IN → WAITING (`serial.manage`)'],
  [
    'remote-ready',
    'markRemoteReady',
    tenantOrPatientIdemHeaders,
    'A remote patient signals readiness; the status is unchanged (patient context MANAGE_SERIALS, or `serial.manage`)',
  ],
  [
    'recall',
    'recallSerial',
    tenantIdemHeaders,
    'CALLED again with a fresh deadline, bounded by recallLimit (`queue.manage`; RECALL_LIMIT_REACHED)',
  ],
  ['no-show', 'markNoShow', tenantIdemHeaders, 'Manual NO_SHOW once the day has started (`serial.manage`)'],
] as const) {
  registry.registerPath({
    method: 'post',
    path: `/api/v1/serials/{id}/${action}`,
    operationId,
    tags: ['serials'],
    security: secured,
    request: { headers, params: idParam, body: { content: json(RowVersionOnlyRequest) } },
    responses: { 200: ok(Serial, description), ...errorResponses },
  });
}
// ADR-021's own exit clause: the two interim consultation transitions are retired by Stage 6, answer
// `410 ENDPOINT_RETIRED`, and are deleted one release later. They existed because Stage 5 had to run a
// full chamber day with no clinical model; `POST /encounters` and `POST /encounters/{id}/complete` do the
// same work properly, and they enforce the covering-doctor rule these two could not (AUTHORIZATION §3).
for (const [action, operationId, replacement] of [
  ['start-consultation', 'startConsultation', 'POST /api/v1/serials/{id}/encounter'],
  ['complete', 'completeConsultation', 'POST /api/v1/encounters/{id}/complete'],
] as const) {
  registry.registerPath({
    method: 'post',
    path: `/api/v1/serials/{id}/${action}`,
    operationId,
    tags: ['serials'],
    deprecated: true,
    security: secured,
    request: { headers: tenantIdemHeaders, params: idParam, body: { content: json(RowVersionOnlyRequest) } },
    responses: {
      410: {
        description: `Retired (ADR-021 exit, Stage 6). Use \`${replacement}\`. Deleted one release later`,
      },
      ...errorResponses,
    },
  });
}

registry.registerPath({
  method: 'post',
  path: '/api/v1/serials/{id}/check-in',
  operationId: 'checkInSerial',
  tags: ['serials'],
  security: secured,
  request: { headers: tenantOrPatientIdemHeaders, params: idParam, body: { content: json(CheckInRequest) } },
  responses: {
    200: ok(
      Serial,
      'Arrival recorded and the serial placed in the queue (`serial.manage`, or the patient in context). A late arrival is placed by the day policy',
    ),
    ...errorResponses,
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/serials/{id}/call',
  operationId: 'callSerial',
  tags: ['serials'],
  security: secured,
  request: { headers: tenantIdemHeaders, params: idParam, body: { content: json(CallSerialRequest) } },
  responses: {
    200: ok(
      Serial,
      'WAITING → CALLED with a recall deadline (`queue.call`). A remote serial needs a ready check-in unless the policy allows an audited override',
    ),
    ...errorResponses,
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/serials/{id}/skip',
  operationId: 'skipSerial',
  tags: ['serials'],
  security: secured,
  request: { headers: tenantIdemHeaders, params: idParam, body: { content: json(SkipSerialRequest) } },
  responses: {
    200: ok(Serial, 'CALLED → SKIPPED; the reason is required (`queue.manage`)'),
    ...errorResponses,
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/serials/{id}/cancel',
  operationId: 'cancelSerial',
  tags: ['serials'],
  security: secured,
  request: {
    headers: tenantOrPatientIdemHeaders,
    params: idParam,
    body: { content: json(CancelSerialRequest) },
  },
  responses: {
    200: ok(
      Serial,
      'Cancelled with its appointment (`serial.manage`; the patient in context only while BOOKED or CONFIRMED)',
    ),
    ...errorResponses,
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/serials/{id}/reschedule',
  operationId: 'rescheduleSerial',
  tags: ['serials'],
  security: secured,
  request: {
    headers: tenantOrPatientIdemHeaders,
    params: idParam,
    body: { content: json(RescheduleSerialRequest) },
  },
  responses: {
    200: ok(
      RescheduleSerialResponse,
      'The old serial becomes RESCHEDULED and a linked serial is issued on the target day, with the appointment moved (`appointment.write`, or patient context BOOK_APPOINTMENTS)',
    ),
    ...errorResponses,
  },
});
