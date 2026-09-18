import { IdempotencyKeyHeader, TenantIdHeader, Timestamp, Uuid, envelope, errorResponses } from './common';
import { bearerAuth, registry, z } from './registry';

// API-IMPLEMENTATION §3.2 (auth and me). Web receives the refresh token only as the `__Host-hm_rt` cookie;
// mobile (`client=android|ios`) receives it in the body. Access tokens are never persisted by web clients.

export const ClientKind = z.enum(['web', 'android', 'ios']).openapi('ClientKind');
export const Locale = z.enum(['bn-BD', 'en-BD']).openapi('Locale');
const Email = z.string().trim().email().max(254);
const Password = z.string().min(1).max(128);
const Phone = z
  .string()
  .min(6)
  .max(24)
  .openapi({ example: '01700000001', description: 'Bangladesh mobile number' });

export const PasswordLoginRequest = registry.register(
  'PasswordLoginRequest',
  z.object({
    email: Email,
    password: Password,
    client: ClientKind.default('web'),
    deviceLabel: z.string().max(80).optional(),
  }),
);

export const OtpRequestRequest = registry.register(
  'OtpRequestRequest',
  z.object({ phone: Phone, purpose: z.literal('LOGIN').default('LOGIN'), locale: Locale.default('bn-BD') }),
);

export const OtpRequestResponse = registry.register(
  'OtpRequestResponse',
  z.object({
    challengeId: Uuid,
    expiresAt: Timestamp,
    hint: z.enum(['SENT', 'RETRY_LATER', 'MAY_ARRIVE']).openapi({
      description:
        'SENT; RETRY_LATER (not delivered, request a new code later); MAY_ARRIVE (uncertain — never auto-resent)',
    }),
  }),
);

export const OtpVerifyRequest = registry.register(
  'OtpVerifyRequest',
  z.object({
    phone: Phone,
    code: z.string().regex(/^\d{6}$/),
    client: ClientKind.default('web'),
    deviceLabel: z.string().max(80).optional(),
  }),
);

export const MeUser = registry.register(
  'MeUser',
  z.object({
    id: Uuid,
    displayName: z.string().nullable(),
    email: z.string().nullable(),
    phoneMasked: z.string().nullable(),
    emailVerified: z.boolean(),
    phoneVerified: z.boolean(),
  }),
);

export const SessionResponse = registry.register(
  'SessionResponse',
  z.object({
    accessToken: z.string(),
    accessTokenExpiresAt: Timestamp,
    csrfToken: z.string().optional().openapi({ description: 'Web only; echo in X-CSRF-Token' }),
    refreshToken: z.string().optional().openapi({ description: 'Mobile only (secure storage)' }),
    refreshTokenExpiresAt: Timestamp.optional(),
    user: MeUser,
  }),
);

export const RefreshRequest = registry.register(
  'RefreshRequest',
  z.object({ refreshToken: z.string().min(20).max(128).optional() }),
);

export const CsrfResponse = registry.register('CsrfResponse', z.object({ csrfToken: z.string() }));

export const PasswordResetRequest = registry.register(
  'PasswordResetRequest',
  z.object({ email: Email, locale: Locale.default('bn-BD') }),
);
export const PasswordResetComplete = registry.register(
  'PasswordResetComplete',
  z.object({ token: z.string().min(20).max(128), newPassword: z.string().min(10).max(128) }),
);

export const MembershipSummary = registry.register(
  'MembershipSummary',
  z.object({
    membershipId: Uuid,
    tenantId: Uuid,
    tenantName: z.string(),
    role: z.enum(['tenant_owner', 'clinic_admin', 'doctor', 'nurse', 'receptionist', 'billing_manager']),
  }),
);

export const MeResponse = registry.register(
  'MeResponse',
  z.object({ user: MeUser, memberships: z.array(MembershipSummary), platformOperator: z.boolean() }),
);

export const PatientContext = registry.register(
  'PatientContext',
  z.object({
    tenantId: Uuid,
    tenantName: z.string(),
    patientId: Uuid,
    patientDisplayName: z.string(),
    relationship: z.string(),
    authorityScope: z.array(z.string()),
  }),
);

export const SessionSummary = registry.register(
  'SessionSummary',
  z.object({
    id: Uuid,
    clientType: z.enum(['WEB', 'ANDROID', 'IOS']),
    deviceLabel: z.string().nullable(),
    createdAt: Timestamp,
    lastSeenAt: Timestamp,
    current: z.boolean(),
  }),
);

const json = (schema: z.ZodTypeAny) => ({ 'application/json': { schema } });
const idem = z.object({ 'Idempotency-Key': IdempotencyKeyHeader });
const ok = (schema: z.ZodTypeAny, description: string) => ({ description, content: json(envelope(schema)) });
const noContent = { description: 'Done', content: json(envelope(z.null())) };
const secured = [{ [bearerAuth.name]: [] }];

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/password/login',
  operationId: 'passwordLogin',
  tags: ['auth'],
  request: { headers: idem, body: { content: json(PasswordLoginRequest) } },
  responses: { 200: ok(SessionResponse, 'Session started'), ...errorResponses },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/otp/request',
  operationId: 'requestOtp',
  tags: ['auth'],
  request: { headers: idem, body: { content: json(OtpRequestRequest) } },
  responses: {
    202: ok(OtpRequestResponse, 'Challenge created (identical for known/unknown phones)'),
    ...errorResponses,
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/otp/verify',
  operationId: 'verifyOtp',
  tags: ['auth'],
  request: { headers: idem, body: { content: json(OtpVerifyRequest) } },
  responses: { 200: ok(SessionResponse, 'Session started'), ...errorResponses },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/session/refresh',
  operationId: 'refreshSession',
  tags: ['auth'],
  description: 'Web: __Host-hm_rt cookie + X-CSRF-Token + allowed Origin. Mobile: refreshToken in the body.',
  request: { body: { content: json(RefreshRequest) } },
  responses: { 200: ok(SessionResponse, 'Rotated'), ...errorResponses },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/session/csrf',
  operationId: 'issueCsrfToken',
  tags: ['auth'],
  description: 'Web reload: new CSRF token from the refresh cookie (allowed Origin required).',
  responses: { 200: ok(CsrfResponse, 'Issued'), ...errorResponses },
});
registry.registerPath({
  method: 'delete',
  path: '/api/v1/auth/session',
  operationId: 'logout',
  tags: ['auth'],
  security: secured,
  responses: { 200: noContent, ...errorResponses },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/session/logout-all',
  operationId: 'logoutAll',
  tags: ['auth'],
  security: secured,
  responses: { 200: noContent, ...errorResponses },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/password/reset/request',
  operationId: 'requestPasswordReset',
  tags: ['auth'],
  request: { headers: idem, body: { content: json(PasswordResetRequest) } },
  responses: {
    202: { description: 'Accepted (identical for unknown accounts)', content: json(envelope(z.null())) },
    ...errorResponses,
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/password/reset/complete',
  operationId: 'completePasswordReset',
  tags: ['auth'],
  request: { headers: idem, body: { content: json(PasswordResetComplete) } },
  responses: { 200: noContent, ...errorResponses },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/me',
  operationId: 'getMe',
  tags: ['me'],
  security: secured,
  responses: { 200: ok(MeResponse, 'Current user and memberships'), ...errorResponses },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/me/patient-contexts',
  operationId: 'listPatientContexts',
  tags: ['me'],
  security: secured,
  responses: { 200: ok(z.array(PatientContext), 'Tenant picker (patient contexts)'), ...errorResponses },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/me/sessions',
  operationId: 'listMySessions',
  tags: ['me'],
  security: secured,
  responses: { 200: ok(z.array(SessionSummary), 'Active sessions'), ...errorResponses },
});
registry.registerPath({
  method: 'delete',
  path: '/api/v1/me/sessions/{id}',
  operationId: 'revokeMySession',
  tags: ['me'],
  security: secured,
  request: { params: z.object({ id: Uuid }) },
  responses: { 200: noContent, ...errorResponses },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/me/tenant-context',
  operationId: 'getTenantContext',
  tags: ['me'],
  security: secured,
  request: { headers: z.object({ 'X-Tenant-ID': TenantIdHeader }) },
  responses: {
    200: ok(
      z.object({
        tenantId: Uuid,
        role: MembershipSummary.shape.role,
        permissions: z.array(z.string()),
        rolePermissionsVersion: z.number().int(),
      }),
      'Effective permissions in the selected tenant',
    ),
    ...errorResponses,
  },
});

export const StepUpVerifyRequest = registry.register(
  'StepUpVerifyRequest',
  z.object({ code: z.string().regex(/^[0-9]{6}$/) }),
);
export const StepUpVerifyResponse = registry.register(
  'StepUpVerifyResponse',
  z.object({ authnMethods: z.array(z.enum(['pwd', 'otp'])) }),
);
registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/step-up/otp/request',
  operationId: 'requestStepUpOtp',
  tags: ['auth'],
  security: secured,
  description:
    'Sends a code to the signed-in user phone (verified). Platform operators need pwd + otp per session.',
  request: { headers: idem, body: { content: json(z.object({ locale: Locale.default('bn-BD') })) } },
  responses: { 202: ok(OtpRequestResponse, 'Challenge created'), ...errorResponses },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/step-up/otp/verify',
  operationId: 'verifyStepUpOtp',
  tags: ['auth'],
  security: secured,
  request: { headers: idem, body: { content: json(StepUpVerifyRequest) } },
  responses: { 200: ok(StepUpVerifyResponse, 'Session upgraded'), ...errorResponses },
});
