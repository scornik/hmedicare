import { bearerAuth, registry, z } from './registry';
import { Uuid, Timestamp, TenantIdHeader, IdempotencyKeyHeader, envelope, errorResponses } from './common';
const FollowUpStatus = registry.register(
  'FollowUpStatus',
  z.enum(['PLANNED', 'BOOKED', 'COMPLETED', 'CANCELLED', 'MISSED']),
);
const FollowUpTerminalStatus = registry.register(
  'FollowUpTerminalStatus',
  z.enum(['COMPLETED', 'CANCELLED', 'MISSED']),
);
const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const CreateFollowUpRequest = z
  .object({
    dueStartDate: DateOnly,
    dueEndDate: DateOnly.nullable().optional(),
    reason: z.string().trim().min(1).max(300),
    instructions: z.string().max(1000).nullable().optional(),
  })
  .strict();
export const UpdateFollowUpRequest = CreateFollowUpRequest.partial()
  .extend({
    expectedRowVersion: z.number().int().positive(),
    status: FollowUpTerminalStatus.optional(),
  })
  .strict();
export const BookFollowUpRequest = z
  .object({
    chamberId: Uuid,
    localDate: DateOnly,
    careMode: z.enum(['PHYSICAL', 'REMOTE', 'HYBRID']),
    slotId: Uuid.nullable().optional(),
    expectedRowVersion: z.number().int().positive(),
  })
  .strict();
export const FollowUpPlan = registry.register(
  'FollowUpPlan',
  z.object({
    id: Uuid,
    tenantId: Uuid,
    patientId: Uuid,
    sourceEncounterId: Uuid,
    doctorProfileId: Uuid,
    dueStartDate: DateOnly,
    dueEndDate: DateOnly.nullable(),
    reason: z.string(),
    instructions: z.string().nullable(),
    status: FollowUpStatus,
    appointmentId: Uuid.nullable(),
    serialId: Uuid.nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    createdByUserId: Uuid.nullable(),
    updatedByUserId: Uuid.nullable(),
    rowVersion: z.number().int(),
  }),
);
import { Appointment } from './scheduling';
for (const r of [
  {
    method: 'get' as const,
    path: '/api/v1/encounters/{id}/follow-ups',
    operationId: 'listEncounterFollowUps',
    result: z.array(FollowUpPlan),
  },
  {
    method: 'post' as const,
    path: '/api/v1/encounters/{id}/follow-ups',
    operationId: 'createFollowUp',
    body: CreateFollowUpRequest,
    result: FollowUpPlan,
  },
  {
    method: 'patch' as const,
    path: '/api/v1/follow-ups/{id}',
    operationId: 'updateFollowUp',
    body: UpdateFollowUpRequest,
    result: FollowUpPlan,
  },
  {
    method: 'post' as const,
    path: '/api/v1/follow-ups/{id}/book',
    operationId: 'bookFollowUp',
    body: BookFollowUpRequest,
    result: Appointment,
  },
])
  registry.registerPath({
    method: r.method,
    path: r.path,
    operationId: r.operationId,
    tags: ['follow-up'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      params: z.object({ id: Uuid }),
      headers: z.object({
        'X-Tenant-ID': TenantIdHeader,
        'Idempotency-Key': r.method === 'post' ? IdempotencyKeyHeader : IdempotencyKeyHeader.optional(),
        'X-Patient-Context': Uuid.optional(),
      }),
      ...(r.body ? { body: { content: { 'application/json': { schema: r.body } } } } : {}),
    },
    responses: {
      [r.method === 'post' ? 201 : 200]: {
        description: 'Authorized follow-up result',
        content: { 'application/json': { schema: envelope(r.result) } },
      },
      ...errorResponses,
    },
  });
