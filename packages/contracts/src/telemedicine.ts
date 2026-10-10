import { bearerAuth, registry, z } from './registry';
import { Uuid, Timestamp, TenantIdHeader, IdempotencyKeyHeader, envelope, errorResponses } from './common';

export const TelemedicineSession = registry.register(
  'TelemedicineSession',
  z.object({
    id: Uuid,
    encounterId: Uuid,
    status: z.enum(['PENDING', 'ACTIVE', 'ENDED', 'FAILED', 'EXPIRED']),
    issuedAt: Timestamp,
    expiresAt: Timestamp,
    endedAt: Timestamp.nullable(),
    endedReason: z.string().nullable(),
    recordingPolicy: z.literal('DISABLED'),
    rowVersion: z.number().int().positive(),
  }),
);
export const TelemedicineJoinToken = registry.register(
  'TelemedicineJoinToken',
  z.object({
    sessionId: Uuid,
    participantId: Uuid,
    provider: z.string(),
    token: z.string(),
    expiresAt: Timestamp,
    recordingPolicy: z.literal('DISABLED'),
  }),
);
for (const route of [
  {
    method: 'post' as const,
    path: '/api/v1/encounters/{id}/telemedicine/session',
    operationId: 'createTelemedicineSession',
    status: 201,
    schema: TelemedicineSession,
    patient: false,
    idem: true,
  },
  {
    method: 'get' as const,
    path: '/api/v1/telemedicine/sessions/{id}',
    operationId: 'getTelemedicineSession',
    status: 200,
    schema: TelemedicineSession,
    patient: true,
    idem: false,
  },
  {
    method: 'post' as const,
    path: '/api/v1/telemedicine/sessions/{id}/join-token',
    operationId: 'issueTelemedicineJoinToken',
    status: 200,
    schema: TelemedicineJoinToken,
    patient: true,
    idem: true,
  },
  {
    method: 'post' as const,
    path: '/api/v1/telemedicine/sessions/{id}/end',
    operationId: 'endTelemedicineSession',
    status: 200,
    schema: TelemedicineSession,
    patient: false,
    idem: true,
  },
])
  registry.registerPath({
    method: route.method,
    path: route.path,
    operationId: route.operationId,
    tags: ['Telemedicine'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      params: z.object({ id: Uuid }),
      headers: z.object({
        'X-Tenant-ID': TenantIdHeader,
        ...(route.patient ? { 'X-Patient-Context': Uuid.optional() } : {}),
        ...(route.idem ? { 'Idempotency-Key': IdempotencyKeyHeader } : {}),
      }),
    },
    responses: {
      [route.status]: {
        description:
          'Authorized remote-session operation. Recording disabled; join tokens are never replayed or stored. Production requires a selected provider.',
        content: { 'application/json': { schema: envelope(route.schema) } },
      },
      ...errorResponses,
    },
  });
