import { IdempotencyKeyHeader, TenantIdHeader, Timestamp, Uuid, envelope, errorResponses } from './common';
import { bearerAuth, registry, z } from './registry';

// API-IMPLEMENTATION §3.3 (memberships, coverages) and §3.12 (tenant bootstrap).
const StaffRole = z.enum([
  'tenant_owner',
  'clinic_admin',
  'doctor',
  'nurse',
  'receptionist',
  'billing_manager',
]);
const Overrides = z
  .object({ grants: z.array(z.string().max(64)).max(80), denials: z.array(z.string().max(64)).max(80) })
  .openapi('MembershipPermissionOverrides');

export const Membership = registry.register(
  'Membership',
  z.object({
    id: Uuid,
    userId: Uuid,
    displayName: z.string().nullable(),
    email: z.string().nullable(),
    role: StaffRole,
    status: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED']),
    permissions: Overrides,
    clinicIds: z.array(Uuid),
    chamberIds: z.array(Uuid),
    rowVersion: z.number().int(),
  }),
);

export const CreateMembershipRequest = registry.register(
  'CreateMembershipRequest',
  z
    .object({
      email: z.string().trim().email().max(254).optional(),
      phone: z.string().min(6).max(24).optional(),
      displayName: z.string().trim().min(1).max(120),
      role: StaffRole,
      permissions: Overrides.optional(),
      clinicIds: z.array(Uuid).max(50).optional(),
      chamberIds: z.array(Uuid).max(200).optional(),
    })
    .refine((v) => v.email !== undefined || v.phone !== undefined, {
      message: 'email or phone required',
      path: ['email'],
    }),
);

export const UpdateMembershipRequest = registry.register(
  'UpdateMembershipRequest',
  z.object({
    expectedRowVersion: z.number().int().min(1),
    role: StaffRole.optional(),
    permissions: Overrides.optional(),
    clinicIds: z.array(Uuid).max(50).optional(),
    chamberIds: z.array(Uuid).max(200).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'REMOVED']).optional(),
  }),
);

export const Coverage = registry.register(
  'DoctorCoverage',
  z.object({
    id: Uuid,
    coveredDoctorProfileId: Uuid,
    coveringDoctorProfileId: Uuid,
    startsAt: Timestamp,
    endsAt: Timestamp,
    reason: z.string(),
    status: z.enum(['ACTIVE', 'REVOKED']),
    rowVersion: z.number().int(),
  }),
);

export const GrantCoverageRequest = registry.register(
  'GrantCoverageRequest',
  z.object({
    coveredDoctorProfileId: Uuid,
    coveringDoctorProfileId: Uuid,
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    reason: z.string().trim().min(1).max(300),
  }),
);

export const RevokeCoverageRequest = registry.register(
  'RevokeCoverageRequest',
  z.object({ expectedRowVersion: z.number().int().min(1) }),
);

export const BootstrapTenantRequest = registry.register(
  'BootstrapTenantRequest',
  z.object({
    name: z.string().trim().min(2).max(200),
    slug: z
      .string()
      .regex(/^[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])$/)
      .optional(),
    practiceType: z.enum(['SOLO', 'GROUP']),
    owner: z
      .object({
        email: z.string().trim().email().max(254).optional(),
        phone: z.string().min(6).max(24).optional(),
        displayName: z.string().trim().min(1).max(120),
      })
      .refine((v) => v.email !== undefined || v.phone !== undefined, {
        message: 'email or phone required',
        path: ['email'],
      }),
  }),
);

export const BootstrapTenantResponse = registry.register(
  'BootstrapTenantResponse',
  z.object({
    tenantId: Uuid,
    slug: z.string(),
    ownerUserId: Uuid,
    ownerMembershipId: Uuid,
    ownerDoctorProfileId: Uuid.nullable(),
  }),
);

const json = (schema: z.ZodTypeAny) => ({ 'application/json': { schema } });
const secured = [{ [bearerAuth.name]: [] }];
const tenantHeaders = z.object({ 'X-Tenant-ID': TenantIdHeader });
const tenantIdemHeaders = z.object({
  'X-Tenant-ID': TenantIdHeader,
  'Idempotency-Key': IdempotencyKeyHeader,
});
const ok = (schema: z.ZodTypeAny, description: string) => ({ description, content: json(envelope(schema)) });

registry.registerPath({
  method: 'get',
  path: '/api/v1/memberships',
  operationId: 'listMemberships',
  tags: ['tenant'],
  security: secured,
  request: { headers: tenantHeaders },
  responses: { 200: ok(z.array(Membership), 'Memberships (membership.manage)'), ...errorResponses },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/memberships',
  operationId: 'createMembership',
  tags: ['tenant'],
  security: secured,
  request: { headers: tenantIdemHeaders, body: { content: json(CreateMembershipRequest) } },
  responses: { 201: ok(Membership, 'Created'), ...errorResponses },
});
registry.registerPath({
  method: 'patch',
  path: '/api/v1/memberships/{id}',
  operationId: 'updateMembership',
  tags: ['tenant'],
  security: secured,
  request: {
    headers: tenantHeaders,
    params: z.object({ id: Uuid }),
    body: { content: json(UpdateMembershipRequest) },
  },
  responses: { 200: ok(Membership, 'Updated'), ...errorResponses },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/doctor-coverages',
  operationId: 'listCoverages',
  tags: ['tenant'],
  security: secured,
  request: { headers: tenantHeaders },
  responses: { 200: ok(z.array(Coverage), 'Coverages'), ...errorResponses },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/doctor-coverages',
  operationId: 'grantCoverage',
  tags: ['tenant'],
  security: secured,
  request: { headers: tenantIdemHeaders, body: { content: json(GrantCoverageRequest) } },
  responses: { 201: ok(Coverage, 'Granted'), ...errorResponses },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/doctor-coverages/{id}/revoke',
  operationId: 'revokeCoverage',
  tags: ['tenant'],
  security: secured,
  request: {
    headers: tenantIdemHeaders,
    params: z.object({ id: Uuid }),
    body: { content: json(RevokeCoverageRequest) },
  },
  responses: { 200: ok(Coverage, 'Revoked'), ...errorResponses },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/tenants',
  operationId: 'bootstrapTenant',
  tags: ['platform'],
  security: secured,
  description: 'Platform operators only (X-Platform-Context: operator, platform.tenants.bootstrap).',
  request: {
    headers: z.object({
      'X-Platform-Context': z.literal('operator'),
      'Idempotency-Key': IdempotencyKeyHeader,
    }),
    body: { content: json(BootstrapTenantRequest) },
  },
  responses: { 201: ok(BootstrapTenantResponse, 'Tenant created'), ...errorResponses },
});
