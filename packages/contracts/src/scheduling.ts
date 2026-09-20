import { IdempotencyKeyHeader, TenantIdHeader, Timestamp, Uuid, envelope, errorResponses } from './common';
import { LocalDate } from './patient';
import { bearerAuth, registry, z } from './registry';

// API-IMPLEMENTATION §3.3 (clinics) and §3.5 (chambers, schedule rules, chamber days, appointments).
export const CareMode = z.enum(['PHYSICAL', 'REMOTE', 'HYBRID']);
export const ChamberStatus = z.enum(['ACTIVE', 'INACTIVE']);
export const ChamberPaymentMode = z.enum(['PAY_AT_CHAMBER', 'PREPAID_REQUIRED', 'OPTIONAL_ONLINE']);
export const TelemedicinePaymentMode = z.enum(['PREPAID_REQUIRED', 'OPTIONAL_ONLINE']);
export const RuleType = z.enum(['WEEKLY', 'EXCEPTION_OPEN', 'EXCEPTION_CLOSED']);
export const ChamberDayStatus = z.enum(['SCHEDULED', 'OPEN', 'PAUSED', 'CLOSED', 'CANCELLED']);
export const AppointmentStatus = z.enum([
  'REQUESTED',
  'PENDING_PAYMENT',
  'BOOKED',
  'CANCELLED',
  'RESCHEDULED',
  'FULFILLED',
  'NO_SHOW',
]);
export const LocalTime = z
  .string()
  .regex(/^\d{2}:\d{2}$/)
  .openapi({ example: '17:00', description: 'Clinic-local time of day, HH:MM' });
export const CancelReason = z.enum([
  'PATIENT_REQUEST',
  'STAFF_REQUEST',
  'DOCTOR_UNAVAILABLE',
  'DAY_CANCELLED',
  'DAY_CLOSED',
  'DUPLICATE',
  'RESCHEDULED',
  'NO_SHOW_POLICY',
  'PAYMENT_NOT_COMPLETED',
  'OTHER',
]);

// ---------------------------------------------------------------- queue policy (QUEUE §2, C-44)

const nullableInt = (min: number, max: number) => z.number().int().min(min).max(max).nullable();

export const QueuePolicy = registry.register(
  'QueuePolicy',
  z.object({
    recallLimit: z.number().int().min(0).max(10),
    recallDeadlineMinutes: z.number().int().min(1).max(60),
    autoSkipOnRecallDeadline: z.boolean(),
    noShowAfterMinutes: z.number().int().min(5).max(720),
    autoNoShowEnabled: z.boolean(),
    waitingRequiresConfirmation: z.boolean(),
    lateArrivalGraceMinutes: z.number().int().min(0).max(180),
    lateArrivalPlacement: z.enum(['APPEND', 'BY_SERIAL_NUMBER']),
    allowRemoteCallWithoutReady: z.boolean(),
    receptionistMayCall: z.boolean(),
    duplicateOverrideRoles: z.array(z.string().max(32)).max(6),
    dayCloseDisposition: z.object({
      BOOKED: z.enum(['NO_SHOW', 'CANCELLED']),
      CONFIRMED: z.enum(['NO_SHOW', 'CANCELLED']),
      CHECKED_IN: z.enum(['NO_SHOW', 'CANCELLED']),
      WAITING: z.enum(['NO_SHOW', 'CANCELLED']),
      CALLED: z.enum(['NO_SHOW', 'CANCELLED']),
      SKIPPED: z.enum(['NO_SHOW', 'CANCELLED']),
    }),
    capacity: nullableInt(1, 1000),
    advanceBookingEnabled: z.boolean(),
    walkInsEnabled: z.boolean(),
    maxBookedSerials: nullableInt(0, 1000),
    maxWalkIns: nullableInt(0, 1000),
    bookingWindowDays: z.number().int().min(0).max(365),
    bookingCutoffMinutes: z.number().int().min(0).max(1440),
    earlyCheckInMinutes: z.number().int().min(0).max(720),
    avgConsultationMinutes: z.number().int().min(1).max(120),
    slotMinutes: nullableInt(5, 240),
    slotCapacity: z.number().int().min(1).max(50),
  }),
);
export const QueuePolicyPatch = QueuePolicy.partial().openapi('QueuePolicyPatch');

// ---------------------------------------------------------------- clinics (API §3.3)

export const Clinic = registry.register(
  'Clinic',
  z.object({
    id: Uuid,
    name: z.string(),
    smsDisplayName: z.string().nullable(),
    address: z.record(z.string()).nullable(),
    status: ChamberStatus,
    createdAt: Timestamp,
    updatedAt: Timestamp,
    rowVersion: z.number().int(),
  }),
);
export const CreateClinicRequest = registry.register(
  'CreateClinicRequest',
  z.object({
    name: z.string().trim().min(2).max(200),
    smsDisplayName: z.string().trim().max(40).nullable().optional(),
    address: z.record(z.string().max(200)).nullable().optional(),
  }),
);
export const UpdateClinicRequest = registry.register(
  'UpdateClinicRequest',
  z.object({
    expectedRowVersion: z.number().int().min(1),
    name: z.string().trim().min(2).max(200).optional(),
    smsDisplayName: z.string().trim().max(40).nullable().optional(),
    address: z.record(z.string().max(200)).nullable().optional(),
    status: ChamberStatus.optional(),
  }),
);

// ---------------------------------------------------------------- chambers

export const Chamber = registry.register(
  'Chamber',
  z.object({
    id: Uuid,
    clinicId: Uuid,
    doctorProfileId: Uuid,
    doctorDisplayName: z.string(),
    name: z.string(),
    supportsPhysical: z.boolean(),
    supportsRemote: z.boolean(),
    supportsHybrid: z.boolean(),
    defaultQueuePolicy: QueuePolicy,
    status: ChamberStatus,
    chamberPaymentMode: ChamberPaymentMode,
    telemedicinePaymentMode: TelemedicinePaymentMode,
    createdAt: Timestamp,
    updatedAt: Timestamp,
    rowVersion: z.number().int(),
  }),
);
export const CreateChamberRequest = registry.register(
  'CreateChamberRequest',
  z.object({
    clinicId: Uuid,
    doctorProfileId: Uuid,
    name: z.string().trim().min(2).max(120),
    supportsPhysical: z.boolean().default(true),
    supportsRemote: z.boolean().default(false),
    supportsHybrid: z.boolean().default(false),
    defaultQueuePolicy: QueuePolicyPatch.optional(),
    chamberPaymentMode: ChamberPaymentMode.optional(),
    telemedicinePaymentMode: TelemedicinePaymentMode.optional(),
  }),
);
export const UpdateChamberRequest = registry.register(
  'UpdateChamberRequest',
  z.object({
    expectedRowVersion: z.number().int().min(1),
    name: z.string().trim().min(2).max(120).optional(),
    supportsPhysical: z.boolean().optional(),
    supportsRemote: z.boolean().optional(),
    supportsHybrid: z.boolean().optional(),
    defaultQueuePolicy: QueuePolicyPatch.optional(),
    status: ChamberStatus.optional(),
    chamberPaymentMode: ChamberPaymentMode.optional(),
    telemedicinePaymentMode: TelemedicinePaymentMode.optional(),
  }),
);

// ---------------------------------------------------------------- schedule rules

export const ScheduleRule = registry.register(
  'ScheduleRule',
  z.object({
    id: Uuid,
    chamberId: Uuid,
    doctorProfileId: Uuid,
    ruleType: RuleType,
    weekday: z.number().int().min(1).max(7).nullable(),
    exceptionDate: LocalDate.nullable(),
    localStartTime: LocalTime,
    localEndTime: LocalTime,
    capacity: z.number().int().nullable(),
    effectiveFrom: LocalDate,
    effectiveTo: LocalDate.nullable(),
    createdAt: Timestamp,
    rowVersion: z.number().int(),
  }),
);
export const CreateScheduleRuleRequest = registry.register(
  'CreateScheduleRuleRequest',
  z.object({
    ruleType: RuleType,
    weekday: z.number().int().min(1).max(7).nullable().optional(),
    exceptionDate: LocalDate.nullable().optional(),
    localStartTime: LocalTime,
    localEndTime: LocalTime,
    capacity: z.number().int().min(1).max(500).nullable().optional(),
    effectiveFrom: LocalDate,
    effectiveTo: LocalDate.nullable().optional(),
  }),
);
export const EndScheduleRuleRequest = registry.register(
  'EndScheduleRuleRequest',
  z.object({ expectedRowVersion: z.number().int().min(1), effectiveTo: LocalDate }),
);

// ---------------------------------------------------------------- chamber days

export const ChamberDay = registry.register(
  'ChamberDay',
  z.object({
    id: Uuid,
    chamberId: Uuid,
    doctorProfileId: Uuid,
    localDate: LocalDate,
    timezone: z.string(),
    localStartTime: LocalTime,
    localEndTime: LocalTime,
    status: ChamberDayStatus,
    queuePolicy: QueuePolicy,
    nextSerialNumber: z.number().int(),
    queueOrderVersion: z.number().int(),
    expectedDelayMinutes: z.number().int().nullable(),
    closedAt: Timestamp.nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    rowVersion: z.number().int(),
  }),
);
export const AppointmentSlot = registry.register(
  'AppointmentSlot',
  z.object({
    id: Uuid,
    startsAt: Timestamp,
    endsAt: Timestamp,
    localLabel: z.string(),
    capacity: z.number().int(),
    bookedCount: z.number().int(),
    status: z.enum(['OPEN', 'FULL', 'CLOSED']),
  }),
);
export const ChamberDayAvailability = registry.register(
  'ChamberDayAvailability',
  z.object({
    day: ChamberDay,
    counts: z.object({
      nonCancelled: z.number().int(),
      booked: z.number().int(),
      walkIns: z.number().int(),
    }),
    remainingBookings: z.number().int().nullable(),
    slots: z.array(AppointmentSlot),
  }),
);
export const MaterializeChamberDayRequest = registry.register(
  'MaterializeChamberDayRequest',
  z.object({ chamberId: Uuid, localDate: LocalDate }),
);
export const RowVersionOnlyRequest = registry.register(
  'RowVersionOnlyRequest',
  z.object({ expectedRowVersion: z.number().int().min(1) }),
);
export const CancelChamberDayRequest = registry.register(
  'CancelChamberDayRequest',
  z.object({ expectedRowVersion: z.number().int().min(1), reason: z.string().trim().max(300).optional() }),
);
export const RecordDelayRequest = registry.register(
  'RecordDelayRequest',
  z.object({
    expectedQueueOrderVersion: z.number().int().min(1),
    delayMinutes: z.number().int().min(0).max(720),
    reasonCode: z.enum(['DOCTOR_LATE', 'EMERGENCY', 'OVERRUN', 'OTHER']),
  }),
);
export const UpdateChamberDayPolicyRequest = registry.register(
  'UpdateChamberDayPolicyRequest',
  z.object({ expectedQueueOrderVersion: z.number().int().min(1), policy: QueuePolicyPatch }),
);

// ---------------------------------------------------------------- appointments

export const Appointment = registry.register(
  'Appointment',
  z.object({
    id: Uuid,
    patientId: Uuid,
    doctorProfileId: Uuid,
    chamberId: Uuid,
    chamberDayId: Uuid,
    localDate: LocalDate,
    slotId: Uuid.nullable(),
    slotLabel: z.string().nullable(),
    source: z.enum(['ADVANCE_BOOKING', 'WALK_IN', 'FOLLOW_UP', 'RESCHEDULE']),
    careMode: CareMode,
    status: AppointmentStatus,
    paymentRequirement: z.enum(['NONE', 'OPTIONAL', 'PREPAID']),
    paymentStatus: z.enum(['NOT_REQUIRED', 'PENDING', 'PAID', 'WAIVED', 'REFUNDED']),
    reason: z.string().nullable(),
    cancelReason: z.string().nullable(),
    rescheduledFromAppointmentId: Uuid.nullable(),
    bookedByUserId: Uuid,
    bookedOnBehalf: z.enum(['SELF', 'GUARDIAN', 'STAFF']).nullable(),
    serial: z.object({ id: Uuid, serialNumber: z.number().int(), status: z.string() }).nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    rowVersion: z.number().int(),
  }),
);
export const CreateAppointmentRequest = registry.register(
  'CreateAppointmentRequest',
  z.object({
    chamberId: Uuid,
    localDate: LocalDate,
    patientId: Uuid,
    careMode: CareMode,
    slotId: Uuid.nullable().optional(),
    reason: z.string().trim().max(300).nullable().optional(),
    source: z.enum(['ADVANCE_BOOKING', 'FOLLOW_UP']).optional(),
  }),
);
export const CancelAppointmentRequest = registry.register(
  'CancelAppointmentRequest',
  z.object({ expectedRowVersion: z.number().int().min(1), reason: CancelReason }),
);
export const AppointmentListResponse = registry.register(
  'AppointmentListResponse',
  z.object({ items: z.array(Appointment), nextCursor: z.string().nullable(), hasMore: z.boolean() }),
);

// ---------------------------------------------------------------- paths

const json = (schema: z.ZodTypeAny) => ({ 'application/json': { schema } });
const secured = [{ [bearerAuth.name]: [] }];
const tenantHeaders = z.object({ 'X-Tenant-ID': TenantIdHeader });
const tenantIdemHeaders = z.object({
  'X-Tenant-ID': TenantIdHeader,
  'Idempotency-Key': IdempotencyKeyHeader,
});
const PatientContextHeader = Uuid.openapi({ param: { name: 'X-Patient-Context', in: 'header' } });
const tenantOrPatientHeaders = z.object({
  'X-Tenant-ID': TenantIdHeader,
  'X-Patient-Context': PatientContextHeader.optional(),
});
const tenantOrPatientIdemHeaders = z.object({
  'X-Tenant-ID': TenantIdHeader,
  'X-Patient-Context': PatientContextHeader.optional(),
  'Idempotency-Key': IdempotencyKeyHeader,
});
const ok = (schema: z.ZodTypeAny, description: string) => ({ description, content: json(envelope(schema)) });
const idParam = z.object({ id: Uuid });
const cursorQuery = {
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
};

// clinics
registry.registerPath({
  method: 'get',
  path: '/api/v1/clinics',
  operationId: 'listClinics',
  tags: ['clinics'],
  security: secured,
  request: { headers: tenantHeaders },
  responses: {
    200: ok(z.array(Clinic), 'Clinics of the tenant (clinic.manage or appointment.read)'),
    ...errorResponses,
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/clinics',
  operationId: 'createClinic',
  tags: ['clinics'],
  security: secured,
  request: { headers: tenantIdemHeaders, body: { content: json(CreateClinicRequest) } },
  responses: { 201: ok(Clinic, 'Created (clinic.manage)'), ...errorResponses },
});
registry.registerPath({
  method: 'patch',
  path: '/api/v1/clinics/{id}',
  operationId: 'updateClinic',
  tags: ['clinics'],
  security: secured,
  request: { headers: tenantIdemHeaders, params: idParam, body: { content: json(UpdateClinicRequest) } },
  responses: { 200: ok(Clinic, 'Updated (clinic.manage)'), ...errorResponses },
});

// chambers
registry.registerPath({
  method: 'get',
  path: '/api/v1/chambers',
  operationId: 'listChambers',
  tags: ['chambers'],
  security: secured,
  request: {
    headers: tenantOrPatientHeaders,
    query: z.object({
      clinicId: Uuid.optional(),
      doctorProfileId: Uuid.optional(),
      status: ChamberStatus.optional(),
    }),
  },
  responses: {
    200: ok(z.array(Chamber), 'Chambers (appointment.read; patient context: public info)'),
    ...errorResponses,
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/chambers',
  operationId: 'createChamber',
  tags: ['chambers'],
  security: secured,
  request: { headers: tenantIdemHeaders, body: { content: json(CreateChamberRequest) } },
  responses: { 201: ok(Chamber, 'Created (chamber.manage)'), ...errorResponses },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/chambers/{id}',
  operationId: 'getChamber',
  tags: ['chambers'],
  security: secured,
  request: { headers: tenantOrPatientHeaders, params: idParam },
  responses: { 200: ok(Chamber, 'Chamber'), ...errorResponses },
});
registry.registerPath({
  method: 'patch',
  path: '/api/v1/chambers/{id}',
  operationId: 'updateChamber',
  tags: ['chambers'],
  security: secured,
  request: { headers: tenantIdemHeaders, params: idParam, body: { content: json(UpdateChamberRequest) } },
  responses: {
    200: ok(Chamber, 'Updated (chamber.manage); STALE_VERSION on a stale expectedRowVersion'),
    ...errorResponses,
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/chambers/{id}/schedule-rules',
  operationId: 'listScheduleRules',
  tags: ['chambers'],
  security: secured,
  request: { headers: tenantHeaders, params: idParam },
  responses: {
    200: ok(z.array(ScheduleRule), 'Schedule rules of the chamber (appointment.read)'),
    ...errorResponses,
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/chambers/{id}/schedule-rules',
  operationId: 'createScheduleRule',
  tags: ['chambers'],
  security: secured,
  request: {
    headers: tenantIdemHeaders,
    params: idParam,
    body: { content: json(CreateScheduleRuleRequest) },
  },
  responses: {
    201: ok(ScheduleRule, 'Created (schedule.manage); overlapping weekly rules are refused'),
    ...errorResponses,
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/schedule-rules/{id}/end',
  operationId: 'endScheduleRule',
  tags: ['chambers'],
  security: secured,
  request: { headers: tenantIdemHeaders, params: idParam, body: { content: json(EndScheduleRuleRequest) } },
  responses: { 200: ok(ScheduleRule, 'Rule ended on effectiveTo (schedule.manage)'), ...errorResponses },
});

// chamber days
registry.registerPath({
  method: 'get',
  path: '/api/v1/chamber-days',
  operationId: 'listChamberDays',
  tags: ['chamber-days'],
  security: secured,
  request: {
    headers: tenantHeaders,
    query: z.object({
      chamberId: Uuid.optional(),
      doctorProfileId: Uuid.optional(),
      from: LocalDate,
      to: LocalDate,
    }),
  },
  responses: {
    200: ok(z.array(ChamberDay), 'Chamber days in the local date range (≤ 62 days)'),
    ...errorResponses,
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/chamber-days',
  operationId: 'materializeChamberDay',
  tags: ['chamber-days'],
  security: secured,
  request: { headers: tenantIdemHeaders, body: { content: json(MaterializeChamberDayRequest) } },
  responses: {
    201: ok(
      ChamberDay,
      'Materialized from the schedule rules, or the existing day when it was already materialized (idempotent create, schedule.manage)',
    ),
    ...errorResponses,
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/chamber-days/{id}',
  operationId: 'getChamberDay',
  tags: ['chamber-days'],
  security: secured,
  request: { headers: tenantOrPatientHeaders, params: idParam },
  responses: { 200: ok(ChamberDay, 'Chamber day'), ...errorResponses },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/chamber-days/{id}/availability',
  operationId: 'getChamberDayAvailability',
  tags: ['chamber-days'],
  security: secured,
  request: { headers: tenantOrPatientHeaders, params: idParam },
  responses: { 200: ok(ChamberDayAvailability, 'Slots and remaining capacity'), ...errorResponses },
});
for (const [action, operationId, description] of [
  ['open', 'openChamberDay', 'SCHEDULED/PAUSED → OPEN (schedule.manage)'],
  ['pause', 'pauseChamberDay', 'OPEN → PAUSED (schedule.manage)'],
  ['close', 'closeChamberDay', 'OPEN/PAUSED → CLOSED; settles remaining serials (chamber_day.close)'],
] as const) {
  registry.registerPath({
    method: 'post',
    path: `/api/v1/chamber-days/{id}/${action}`,
    operationId,
    tags: ['chamber-days'],
    security: secured,
    request: { headers: tenantIdemHeaders, params: idParam, body: { content: json(RowVersionOnlyRequest) } },
    responses: { 200: ok(ChamberDay, description), ...errorResponses },
  });
}
registry.registerPath({
  method: 'post',
  path: '/api/v1/chamber-days/{id}/cancel',
  operationId: 'cancelChamberDay',
  tags: ['chamber-days'],
  security: secured,
  request: { headers: tenantIdemHeaders, params: idParam, body: { content: json(CancelChamberDayRequest) } },
  responses: {
    200: ok(
      ChamberDay,
      'Day cancelled; serials and appointments cancelled with DAY_CANCELLED (schedule.manage)',
    ),
    ...errorResponses,
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/chamber-days/{id}/delay',
  operationId: 'recordChamberDelay',
  tags: ['chamber-days'],
  security: secured,
  request: { headers: tenantIdemHeaders, params: idParam, body: { content: json(RecordDelayRequest) } },
  responses: {
    200: ok(ChamberDay, 'Delay recorded; queueOrderVersion bumped (queue.manage)'),
    ...errorResponses,
  },
});
registry.registerPath({
  method: 'put',
  path: '/api/v1/chamber-days/{id}/queue-policy',
  operationId: 'updateChamberDayPolicy',
  tags: ['chamber-days'],
  security: secured,
  request: {
    headers: tenantIdemHeaders,
    params: idParam,
    body: { content: json(UpdateChamberDayPolicyRequest) },
  },
  responses: { 200: ok(ChamberDay, 'Policy snapshot updated (queue.manage)'), ...errorResponses },
});

// appointments
registry.registerPath({
  method: 'get',
  path: '/api/v1/appointments',
  operationId: 'listAppointments',
  tags: ['appointments'],
  security: secured,
  request: {
    headers: tenantHeaders,
    query: z.object({
      chamberDayId: Uuid.optional(),
      patientId: Uuid.optional(),
      status: AppointmentStatus.optional(),
      ...cursorQuery,
    }),
  },
  responses: { 200: ok(AppointmentListResponse, 'Appointments (appointment.read)'), ...errorResponses },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/appointments',
  operationId: 'createAppointment',
  tags: ['appointments'],
  security: secured,
  request: { headers: tenantOrPatientIdemHeaders, body: { content: json(CreateAppointmentRequest) } },
  responses: {
    201: ok(
      Appointment,
      'Booked with its serial (appointment.write or patient context BOOK_APPOINTMENTS). FEATURE_DISABLED for prepaid chambers while payments are absent (C-45); CAPACITY_EXCEEDED; DUPLICATE_ACTIVE_SERIAL',
    ),
    ...errorResponses,
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/appointments/{id}',
  operationId: 'getAppointment',
  tags: ['appointments'],
  security: secured,
  request: { headers: tenantOrPatientHeaders, params: idParam },
  responses: { 200: ok(Appointment, 'Appointment'), ...errorResponses },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/appointments/{id}/cancel',
  operationId: 'cancelAppointment',
  tags: ['appointments'],
  security: secured,
  request: {
    headers: tenantOrPatientIdemHeaders,
    params: idParam,
    body: { content: json(CancelAppointmentRequest) },
  },
  responses: {
    200: ok(Appointment, 'Cancelled with its serial (appointment.write or patient context)'),
    ...errorResponses,
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/me/appointments',
  operationId: 'listMyAppointments',
  tags: ['appointments'],
  security: secured,
  request: {
    headers: z.object({ 'X-Tenant-ID': TenantIdHeader, 'X-Patient-Context': PatientContextHeader }),
    query: z.object(cursorQuery),
  },
  responses: { 200: ok(AppointmentListResponse, 'The context patient’s appointments'), ...errorResponses },
});
