import { AppError, type Clock, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, type Tx, withTransaction, lockRow, isUniqueViolation } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import { OutboxPort } from '@hmedic/jobs';
import { TenantContextResolver } from '@hmedic/identity-access';
import type {
  AdapterPolicyMetadata,
  DeclaredTier,
  PolicyCredential,
} from '../application/policy/effective-policy';
import type { AICredentialSecrets } from '../application/credentials/credential-secrets';
import { nextAICredentialStatus, type AICredentialStatus, type CredentialAction } from '../domain/credential';

export interface AICredentialActor {
  tenantId: string;
  userId: string;
  requestId?: string;
}
type Row = Awaited<ReturnType<PrismaClient['aiProviderCredential']['findFirstOrThrow']>>;
const credentialView = (row: Row) => ({
  id: row.id,
  doctorProfileId: row.doctorProfileId,
  providerCode: row.providerCode,
  declaredTier: row.declaredTier,
  billingMode: row.billingMode,
  status: row.status,
  secretLast4: row.secretLast4,
  validatedAt: row.validatedAt?.toISOString() ?? null,
  lastErrorClass: row.lastErrorClass,
  rowVersion: row.rowVersion,
});

/** Durable metadata/secret owner. Validation jobs and HTTP composition follow separately. */
export class AICredentialStore {
  private readonly clock: Clock;
  private readonly outbox: OutboxPort;
  constructor(
    private readonly deps: {
      prisma: PrismaClient;
      audit: PrismaAuditPort;
      secrets: AICredentialSecrets;
      enabledProviderCodes: readonly string[];
      metadata(providerCode: string, tier: DeclaredTier): AdapterPolicyMetadata | null;
      platformManagedEnabled?: boolean;
      clock?: Clock;
    },
  ) {
    this.clock = deps.clock ?? systemClock;
    this.outbox = new OutboxPort(this.clock);
  }

  private async authorize(tx: Tx, actor: AICredentialActor, doctorId: string) {
    await lockRow(tx, 'tenants', actor.tenantId);
    const membership = await tx.tenantMembership.findFirst({
      where: { tenantId: actor.tenantId, userId: actor.userId },
    });
    if (!membership) throw new AppError('FORBIDDEN');
    await lockRow(tx, 'tenant_memberships', membership.id, actor.tenantId);
    const context = await new TenantContextResolver(tx).resolve(actor.userId, actor.tenantId);
    if (!context || !(await tx.user.count({ where: { id: actor.userId, status: 'ACTIVE' } })))
      throw new AppError('FORBIDDEN');
    const doctor = await tx.doctorProfile.findFirst({ where: { tenantId: actor.tenantId, id: doctorId } });
    if (!doctor) throw new AppError('FORBIDDEN');
    await lockRow(tx, 'doctor_profiles', doctorId, actor.tenantId);
    const live = await tx.doctorProfile.findFirst({
      where: { tenantId: actor.tenantId, id: doctorId, status: 'ACTIVE' },
    });
    if (!live || (live.userId !== actor.userId && !context.effectivePermissions.has('ai.credentials.manage')))
      throw new AppError('FORBIDDEN');
  }

  private async record(tx: Tx, actor: AICredentialActor, row: Row, event: string) {
    await this.outbox.append(tx, {
      tenantId: actor.tenantId,
      eventName: event,
      eventVersion: 1,
      aggregateType: 'ai_credential',
      aggregateId: row.id,
      correlationId: actor.requestId ?? newId(),
      causationId: null,
      actorId: actor.userId,
      idempotencyKey: null,
      payload: { credentialId: row.id, doctorProfileId: row.doctorProfileId, status: row.status },
    });
    await this.deps.audit.append(tx, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      actorType: 'USER',
      action: event
        .replace(/^AI/, 'Ai')
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .toUpperCase(),
      resourceType: 'ai_credential',
      resourceId: row.id,
      outcome: 'SUCCESS',
      requestId: actor.requestId ?? null,
      metadata: { doctorProfileId: row.doctorProfileId, providerCode: row.providerCode, status: row.status },
    });
  }

  async create(
    actor: AICredentialActor,
    doctorProfileId: string,
    input: {
      providerCode: string;
      declaredTier: DeclaredTier;
      billingMode: PolicyCredential['billingMode'];
      secret: string;
    },
  ) {
    const meta = this.deps.metadata(input.providerCode, input.declaredTier);
    if (
      !meta ||
      meta.providerCode !== input.providerCode ||
      meta.tier !== input.declaredTier ||
      !this.deps.enabledProviderCodes.includes(input.providerCode)
    )
      throw new AppError('POLICY_BLOCKED');
    if (input.billingMode === 'PLATFORM_MANAGED' && this.deps.platformManagedEnabled !== true)
      throw new AppError('FEATURE_DISABLED');
    if (!(
      (input.billingMode === 'DOCTOR_BYOK_FREE' && input.declaredTier === 'FREE') ||
      (input.billingMode === 'DOCTOR_BYOK_PAID' && input.declaredTier === 'PAID') ||
      input.billingMode === 'PLATFORM_MANAGED'
    ))
      throw new AppError('VALIDATION_FAILED');
    try {
      return await withTransaction(this.deps.prisma, async (tx) => {
        await this.authorize(tx, actor, doctorProfileId);
        const id = newId(),
          now = this.clock.now();
        const sealed = this.deps.secrets.seal(
          { credentialId: id, tenantId: actor.tenantId, doctorProfileId, providerCode: input.providerCode },
          input.secret,
        );
        const row = await tx.aiProviderCredential.create({
          data: {
            id,
            tenantId: actor.tenantId,
            doctorProfileId,
            providerCode: input.providerCode,
            declaredTier: input.declaredTier,
            billingMode: input.billingMode,
            ...sealed,
            status: 'PENDING_VALIDATION',
            allowedModelIds: [],
            createdAt: now,
            updatedAt: now,
            createdByUserId: actor.userId,
          },
        });
        await this.record(tx, actor, row, 'AICredentialCreated');
        return credentialView(row);
      });
    } catch (error) {
      if (isUniqueViolation(error, 'uq_ai_credentials')) throw new AppError('AI_CREDENTIAL_DUPLICATE');
      throw error;
    }
  }

  async list(actor: AICredentialActor, doctorProfileId: string) {
    return withTransaction(this.deps.prisma, async (tx) => {
      await this.authorize(tx, actor, doctorProfileId);
      const rows = await tx.aiProviderCredential.findMany({
        where: { tenantId: actor.tenantId, doctorProfileId },
        orderBy: [{ priority: 'asc' }, { id: 'asc' }],
      });
      return rows.map(credentialView);
    });
  }

  async change(
    actor: AICredentialActor,
    doctorProfileId: string,
    id: string,
    expectedRowVersion: number,
    action: Extract<CredentialAction, 'DISABLE' | 'ENABLE' | 'REVALIDATE' | 'REVOKE'>,
  ) {
    if (
      !Number.isSafeInteger(expectedRowVersion) ||
      expectedRowVersion < 1 ||
      !['DISABLE', 'ENABLE', 'REVALIDATE', 'REVOKE'].includes(action)
    )
      throw new AppError('VALIDATION_FAILED');
    return withTransaction(this.deps.prisma, async (tx) => {
      await this.authorize(tx, actor, doctorProfileId);
      const snapshot = await tx.aiProviderCredential.findFirst({
        where: { id, tenantId: actor.tenantId, doctorProfileId },
      });
      if (!snapshot) throw new AppError('RESOURCE_NOT_FOUND');
      await lockRow(tx, 'ai_provider_credentials', id, actor.tenantId);
      const current = await tx.aiProviderCredential.findFirstOrThrow({
        where: { id, tenantId: actor.tenantId, doctorProfileId },
      });
      if (current.rowVersion !== expectedRowVersion) throw new AppError('STALE_VERSION');
      let status: AICredentialStatus;
      try {
        status = nextAICredentialStatus(current.status as AICredentialStatus, action);
      } catch {
        throw new AppError('INVALID_TRANSITION');
      }
      const now = this.clock.now();
      const row = await tx.aiProviderCredential.update({
        where: { id },
        data: {
          status,
          updatedAt: now,
          updatedByUserId: actor.userId,
          rowVersion: { increment: 1 },
          ...(status === 'REVOKED'
            ? {
                encryptedSecret: 'revoked',
                wrappedDataKey: 'revoked',
                keyId: 'revoked',
                secretLast4: '',
                secretFingerprint: `rev_${id.replaceAll('-', '')}`,
                revokedAt: now,
                revokedByUserId: actor.userId,
              }
            : {}),
        },
      });
      if (status === 'DISABLED' || status === 'REVOKED') {
        await tx.aiCredentialFallback.deleteMany({
          where: { tenantId: actor.tenantId, doctorProfileId, credentialId: id },
        });
      }
      await this.record(
        tx,
        actor,
        row,
        status === 'REVOKED'
          ? 'AICredentialRevoked'
          : status === 'DISABLED'
            ? 'AICredentialDisabled'
            : 'AICredentialValidationRequested',
      );
      return credentialView(row);
    });
  }
}
