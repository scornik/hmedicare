import { bearerAuth, registry, z } from './registry';
import { Uuid, Timestamp, TenantIdHeader, IdempotencyKeyHeader, envelope, errorResponses } from './common';
const Channel = registry.register('CommunicationChannel', z.enum(['email', 'whatsapp', 'sms']));
const Status = registry.register(
  'CommunicationStatus',
  z.enum([
    'CREATED',
    'CONSENT_CHECKED',
    'QUEUED',
    'SENDING',
    'SENT',
    'DELIVERED',
    'READ',
    'FAILED',
    'RETRY_SCHEDULED',
    'CANCELLED',
  ]),
);
const Preference = registry.register('CommunicationPreferenceValue', z.enum(['OPT_IN', 'OPT_OUT']));
export const SetCommunicationPreferenceRequest = z
  .object({
    channel: Channel,
    preference: Preference,
    consentVersion: z.number().int().positive(),
    contactId: Uuid.nullable().optional(),
  })
  .strict();
export const CommunicationSummary = registry.register(
  'CommunicationSummary',
  z.object({
    id: Uuid,
    channel: Channel,
    purpose: z.string(),
    status: Status,
    businessType: z.string(),
    businessId: Uuid,
    createdAt: Timestamp,
    updatedAt: Timestamp,
    rowVersion: z.number().int(),
  }),
);
export const CommunicationPreferenceView = registry.register(
  'CommunicationPreferenceView',
  z.object({
    id: Uuid,
    channel: Channel,
    preference: Preference,
    contactId: Uuid.nullable(),
    consentVersion: z.number().int(),
    effectiveFrom: Timestamp,
    effectiveTo: Timestamp.nullable(),
    rowVersion: z.number().int(),
  }),
);
for (const route of [
  {
    method: 'get' as const,
    path: '/api/v1/patients/{id}/communications',
    operationId: 'listPatientCommunications',
    result: z.array(CommunicationSummary),
  },
  {
    method: 'get' as const,
    path: '/api/v1/patients/{id}/communication-preferences',
    operationId: 'listCommunicationPreferences',
    result: z.array(CommunicationPreferenceView),
  },
  {
    method: 'put' as const,
    path: '/api/v1/patients/{id}/communication-preferences',
    operationId: 'setCommunicationPreference',
    result: CommunicationPreferenceView,
    body: SetCommunicationPreferenceRequest,
  },
])
  registry.registerPath({
    method: route.method,
    path: route.path,
    operationId: route.operationId,
    tags: ['communication'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      params: z.object({ id: Uuid }),
      headers: z.object({
        'X-Tenant-ID': TenantIdHeader.optional(),
        'X-Patient-Context': Uuid.optional(),
        'Idempotency-Key': IdempotencyKeyHeader.optional(),
      }),
      ...(route.body ? { body: { content: { 'application/json': { schema: route.body } } } } : {}),
    },
    responses: {
      200: {
        description: 'Authorized communication result',
        content: { 'application/json': { schema: envelope(route.result) } },
      },
      ...errorResponses,
    },
  });
const WebhookAdapter = registry.register(
  'CommunicationWebhookAdapter',
  z.enum(['mock-email', 'mock-whatsapp']),
);
const ReceiptStatus = registry.register(
  'CommunicationReceiptStatus',
  z.enum(['accepted', 'delivered', 'read', 'failed']),
);
registry.registerPath({
  method: 'post',
  path: '/api/v1/webhooks/communication/{providerAdapter}',
  operationId: 'receiveCommunicationWebhook',
  tags: ['communication'],
  security: [],
  request: {
    params: z.object({ providerAdapter: WebhookAdapter }),
    headers: z.object({ 'x-mock-signature': z.string().regex(/^[a-f0-9]{64}$/) }),
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              eventId: z.string().min(1).max(191),
              messageId: z.string().min(1).max(191),
              status: ReceiptStatus,
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Authenticated receipt acknowledged',
      content: { 'application/json': { schema: envelope(z.object({ accepted: z.boolean() })) } },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/communication-links/{token}',
  operationId: 'resolveCommunicationLink',
  tags: ['Communication'],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({ token: z.string().regex(/^[A-Za-z0-9]{22}$/) }),
    headers: z.object({ 'X-Tenant-ID': TenantIdHeader, 'X-Patient-Context': Uuid }),
  },
  responses: {
    200: {
      description:
        'Login and a live SELF/guardian VIEW_RECORDS context are required. The token grants no access.',
      content: {
        'application/json': {
          schema: envelope(z.object({ targetType: z.literal('PATIENT_TIMELINE'), patientId: Uuid })),
        },
      },
    },
    ...errorResponses,
  },
});
