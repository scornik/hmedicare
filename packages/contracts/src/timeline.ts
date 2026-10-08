import { registry, z, bearerAuth } from './registry';
import { Uuid, Timestamp, TenantIdHeader, envelope, errorResponses } from './common';
export const TimelineQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(512).optional(),
});
export const TimelineEntry = registry.register(
  'TimelineEntry',
  z.object({
    id: Uuid,
    eventType: z.string(),
    occurredAt: Timestamp,
    summary: z.string(),
    visibility: z.enum(['CLINICAL', 'OPERATIONAL', 'PATIENT_SHARED']),
    source: z
      .object({ type: z.string(), id: Uuid, aggregateId: Uuid, encounterId: Uuid.nullable() })
      .nullable(),
  }),
);
export const TimelinePage = registry.register(
  'TimelinePage',
  z.object({
    items: z.array(TimelineEntry),
    nextCursor: z.string().nullable(),
    projectionVersion: z.number().int(),
    stale: z.boolean(),
  }),
);
registry.registerPath({
  method: 'get',
  path: '/api/v1/patients/{id}/timeline',
  operationId: 'getPatientTimeline',
  tags: ['timeline'],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({ id: Uuid }),
    query: TimelineQuery,
    headers: z.object({ 'X-Tenant-ID': TenantIdHeader, 'X-Patient-Context': Uuid.optional() }),
  },
  responses: {
    200: {
      description:
        'Authorized source references, newest first. Patient contexts need VIEW_RECORDS and see shared entries only. Cursor expires after 15 minutes.',
      content: { 'application/json': { schema: envelope(TimelinePage) } },
    },
    ...errorResponses,
  },
});
