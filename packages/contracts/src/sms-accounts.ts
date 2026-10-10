import { bearerAuth, registry, z } from './registry';
import { Uuid, Timestamp, TenantIdHeader, envelope, errorResponses } from './common';
export const SmsCredentialView = registry.register(
  'SmsCredentialView',
  z.object({
    id: Uuid,
    tenantId: Uuid,
    providerKind: z.literal('SMS'),
    providerCode: z.string(),
    status: registry.register(
      'SmsCredentialStatus',
      z.enum([
        'PENDING_VALIDATION',
        'ACTIVE',
        'UNVERIFIED_UNTIL_FIRST_PAYMENT',
        'INVALID',
        'SUSPENDED_BALANCE',
        'DISABLED',
        'REVOKED',
      ]),
    ),
    secretLast4: z.string(),
    publicIdentifier: z.string().nullable(),
    senderIdStatus: z.string().nullable(),
    validatedAt: Timestamp.nullable(),
    lastErrorClass: z.string().nullable(),
    rowVersion: z.number().int().positive(),
    balanceAlertBdt: z.string().nullable(),
  }),
);
export const CreateSmsCredentialRequest = z
  .object({
    apiKey: z.string().min(8).max(256).regex(/^\S+$/),
    senderId: z
      .string()
      .min(1)
      .max(11)
      .regex(/^[A-Za-z0-9 _-]+$/),
    balanceAlertBdt: z
      .string()
      .regex(/^\d{1,10}(?:\.\d{1,2})?$/)
      .optional(),
  })
  .strict();
export const ValidateSmsCredentialRequest = z.object({ rowVersion: z.number().int().positive() }).strict();
const BalanceStatus = registry.register('SmsBalanceParseStatus', z.enum(['PARSED', 'UNPARSED', 'ERROR']));
const Balance = registry.register(
  'SmsBalanceView',
  z.object({
    balance: z.string().nullable(),
    currencyText: z.string().nullable(),
    parseStatus: BalanceStatus,
    errorClass: z.string().nullable(),
    checkedAt: Timestamp,
  }),
);
const root = '/api/v1/tenant/sms-credentials';
for (const route of [
  {
    method: 'get' as const,
    path: root,
    operationId: 'listSmsCredentials',
    result: z.array(SmsCredentialView),
    body: undefined,
    id: false,
  },
  {
    method: 'post' as const,
    path: root,
    operationId: 'createSmsCredential',
    result: SmsCredentialView,
    body: CreateSmsCredentialRequest,
    id: false,
  },
  {
    method: 'delete' as const,
    path: root + '/{id}',
    operationId: 'revokeSmsCredential',
    result: SmsCredentialView,
    body: undefined,
    id: true,
  },
  {
    method: 'post' as const,
    path: root + '/{id}/validate',
    operationId: 'validateSmsCredential',
    result: z.object({ credential: SmsCredentialView, balance: Balance.nullable() }),
    body: ValidateSmsCredentialRequest,
    id: true,
  },
  {
    method: 'get' as const,
    path: root + '/{id}/balance',
    operationId: 'readSmsCredentialBalance',
    result: Balance.nullable(),
    body: undefined,
    id: true,
  },
])
  registry.registerPath({
    method: route.method,
    path: route.path,
    operationId: route.operationId,
    tags: ['SMS accounts'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      headers: z.object({ 'X-Tenant-ID': TenantIdHeader }),
      ...(route.id ? { params: z.object({ id: Uuid }) } : {}),
      ...(route.body ? { body: { content: { 'application/json': { schema: route.body } } } } : {}),
    },
    responses: {
      200: {
        description: 'Authorized account metadata; secrets are write-only.',
        content: { 'application/json': { schema: envelope(route.result) } },
      },
      ...errorResponses,
    },
  });
registry.registerPath({
  method: 'get',
  path: '/api/v1/platform/sms/balance',
  operationId: 'readPlatformSmsBalance',
  tags: ['SMS accounts'],
  security: [{ [bearerAuth.name]: [] }],
  request: { headers: z.object({ 'X-Platform-Context': z.literal('operator') }) },
  responses: {
    200: {
      description: 'Operator-only balance history. Spend values are estimates.',
      content: {
        'application/json': {
          schema: envelope(
            z.object({
              latest: Balance.nullable(),
              trend: z.array(
                z.object({
                  checkedAt: Timestamp,
                  balance: z.string().nullable(),
                  parseStatus: BalanceStatus,
                }),
              ),
              dailySpendEstimate: z.array(z.object({ day: z.string(), estimateBdt: z.string() })),
              truncated: z.boolean(),
            }),
          ),
        },
      },
    },
    ...errorResponses,
  },
});
