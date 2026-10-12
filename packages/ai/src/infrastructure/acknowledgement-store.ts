import { AppError, type Clock, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, type Tx, isUniqueViolation, lockRow, withTransaction } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import { TenantContextResolver } from '@hmedic/identity-access';
import {
  type AcknowledgementLocale,
  type AcknowledgementTier,
  CURRENT_ACK_TEXT_VERSION,
  acknowledgementTextSha256,
  findAcknowledgementText,
} from '../domain/acknowledgement-texts';

/**
 * Data-use acknowledgements (AIPOL-002, ADR-017 §3).
 *
 * A doctor's recorded statement that they understand what sending patient data to a given provider and
 * tier means. The policy engine treats it as a hard precondition, so what matters here is that the row
 * says exactly which words were agreed and stops counting the moment those words change.
 *
 * Three rules carry the weight.
 *
 * **Only the current text version can be acknowledged.** Accepting an older version would let a doctor
 * re-affirm terms the product has since replaced, which is the one thing the version exists to prevent.
 *
 * **One live acknowledgement per doctor, provider and tier.** Enforced by `uq_ai_ack_live` on the
 * generated `live_ack_key`, so a double submit resolves to one row rather than two rows that disagree.
 *
 * **Superseding is not deleting.** A new text version revokes the old rows with
 * `TEXT_VERSION_SUPERSEDED` and leaves them readable, because "this doctor agreed to v1 on this date"
 * stays true after v2 ships.
 */
export interface AIAcknowledgementActor {
  tenantId: string;
  userId: string;
  requestId?: string;
}

export interface RecordAcknowledgementInput {
  doctorProfileId: string;
  providerCode: string;
  tier: AcknowledgementTier;
  locale: AcknowledgementLocale;
  /** The version the screen displayed. Checked against the current one rather than trusted. */
  termsTextVersion: string;
}

type AckRow = Awaited<ReturnType<PrismaClient['aiDataUseAcknowledgement']['findFirstOrThrow']>>;

const ackView = (row: AckRow) => ({
  id: row.id,
  doctorProfileId: row.doctorProfileId,
  providerCode: row.providerCode,
  tier: row.tier,
  termsTextVersion: row.termsTextVersion,
  termsTextSha256: row.termsTextSha256,
  acknowledgedByUserId: row.acknowledgedByUserId,
  acknowledgedAt: row.acknowledgedAt.toISOString(),
  revokedAt: row.revokedAt?.toISOString() ?? null,
  revokeReason: row.revokeReason,
  rowVersion: row.rowVersion,
});

export interface AIAcknowledgementStoreDeps {
  prisma: PrismaClient;
  audit: PrismaAuditPort;
  /** Provider codes this deployment composes; a doctor cannot acknowledge one that does not exist. */
  enabledProviderCodes: readonly string[];
  clock?: Clock;
}

export class AIAcknowledgementStore {
  private readonly clock: Clock;

  constructor(private readonly deps: AIAcknowledgementStoreDeps) {
    this.clock = deps.clock ?? systemClock;
  }

  /**
   * The acting doctor, or someone holding `ai.credentials.manage` on their behalf.
   *
   * Same rule as the credential store: a doctor acts for themselves, and an administrator needs the
   * explicit permission. Re-resolved inside the transaction so a role lost since the screen opened
   * cannot record an acknowledgement.
   */
  private async authorize(tx: Tx, actor: AIAcknowledgementActor, doctorProfileId: string) {
    await lockRow(tx, 'tenants', actor.tenantId);
    const membership = await tx.tenantMembership.findFirst({
      where: { tenantId: actor.tenantId, userId: actor.userId, status: 'ACTIVE' },
    });
    if (!membership) throw new AppError('FORBIDDEN');
    await lockRow(tx, 'tenant_memberships', membership.id, actor.tenantId);
    if (!(await tx.user.count({ where: { id: actor.userId, status: 'ACTIVE' } })))
      throw new AppError('FORBIDDEN');
    const context = await new TenantContextResolver(tx).resolve(actor.userId, actor.tenantId);
    if (!context) throw new AppError('FORBIDDEN');
    await lockRow(tx, 'doctor_profiles', doctorProfileId, actor.tenantId);
    const doctor = await tx.doctorProfile.findFirst({
      where: { tenantId: actor.tenantId, id: doctorProfileId, status: 'ACTIVE' },
    });
    if (
      !doctor ||
      (doctor.userId !== actor.userId && !context.effectivePermissions.has('ai.credentials.manage'))
    ) {
      throw new AppError('FORBIDDEN');
    }
  }

  /** Records an acknowledgement of the current text. */
  async record(actor: AIAcknowledgementActor, input: RecordAcknowledgementInput) {
    if (input.termsTextVersion !== CURRENT_ACK_TEXT_VERSION) {
      // Acknowledging a superseded text would re-affirm terms the product has replaced.
      throw new AppError('VALIDATION_FAILED', undefined, {
        fieldErrors: [
          {
            path: 'termsTextVersion',
            code: 'superseded',
            message: 'validation.ai_ack_text_superseded',
          },
        ],
      });
    }
    if (!this.deps.enabledProviderCodes.includes(input.providerCode)) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fieldErrors: [
          {
            path: 'providerCode',
            code: 'invalid_enum_value',
            message: 'validation.ai_provider_unknown',
          },
        ],
      });
    }
    // Looked up before the transaction: an unknown tier/locale pair is a bad request, not a conflict.
    const text = findAcknowledgementText(input.termsTextVersion, input.tier, input.locale);
    const sha256 = acknowledgementTextSha256(text.body);
    const now = this.clock.now();

    return withTransaction(
      this.deps.prisma,
      async (tx) => {
        await this.authorize(tx, actor, input.doctorProfileId);

        const existing = await tx.aiDataUseAcknowledgement.findFirst({
          where: {
            tenantId: actor.tenantId,
            doctorProfileId: input.doctorProfileId,
            providerCode: input.providerCode,
            tier: input.tier,
            revokedAt: null,
          },
        });
        if (existing) {
          // Already acknowledged, same words. Returned as it stands rather than written again, so a
          // double submit does not produce a second row claiming a later date.
          if (existing.termsTextVersion === input.termsTextVersion) return ackView(existing);
          // An older live row for a superseded version: withdraw it so the unique live key is free.
          await this.revokeRow(tx, actor, existing, 'TEXT_VERSION_SUPERSEDED', now);
        }

        const id = newId();
        try {
          const row = await tx.aiDataUseAcknowledgement.create({
            data: {
              id,
              tenantId: actor.tenantId,
              doctorProfileId: input.doctorProfileId,
              providerCode: input.providerCode,
              tier: input.tier,
              termsTextVersion: input.termsTextVersion,
              termsTextSha256: sha256,
              acknowledgedByUserId: actor.userId,
              acknowledgedAt: now,
              createdAt: now,
              updatedAt: now,
              createdByUserId: actor.userId,
              updatedByUserId: actor.userId,
            },
          });
          await this.deps.audit.append(tx, {
            tenantId: actor.tenantId,
            actorUserId: actor.userId,
            actorType: 'USER',
            action: 'AI_DATA_USE_ACKNOWLEDGED',
            resourceType: 'ai_data_use_acknowledgement',
            resourceId: row.id,
            outcome: 'SUCCESS',
            requestId: actor.requestId ?? null,
            // Scope and which text, never the body: the registry holds the words and the hash ties the
            // row to them.
            metadata: {
              doctorProfileId: row.doctorProfileId,
              providerCode: row.providerCode,
              tier: row.tier,
              termsTextVersion: row.termsTextVersion,
              locale: input.locale,
            },
          });
          return ackView(row);
        } catch (e) {
          // `uq_ai_ack_live`: two submits raced and the other won. The winner recorded the same
          // statement for the same scope, so its row is the answer — returning it is honest, where an
          // error would tell the doctor their acknowledgement failed when it exists.
          if (!isUniqueViolation(e)) throw e;
          const winner = await tx.aiDataUseAcknowledgement.findFirst({
            where: {
              tenantId: actor.tenantId,
              doctorProfileId: input.doctorProfileId,
              providerCode: input.providerCode,
              tier: input.tier,
              revokedAt: null,
            },
          });
          if (!winner) throw e;
          return ackView(winner);
        }
      },
      { context: 'ai:ack:record' },
    );
  }

  /** Live acknowledgements for a doctor. */
  async list(actor: AIAcknowledgementActor, doctorProfileId: string) {
    return withTransaction(
      this.deps.prisma,
      async (tx) => {
        await this.authorize(tx, actor, doctorProfileId);
        const rows = await tx.aiDataUseAcknowledgement.findMany({
          where: { tenantId: actor.tenantId, doctorProfileId },
          orderBy: { acknowledgedAt: 'desc' },
        });
        return rows.map(ackView);
      },
      { context: 'ai:ack:list' },
    );
  }

  /** The doctor withdrawing their own acknowledgement. */
  async withdraw(actor: AIAcknowledgementActor, acknowledgementId: string) {
    const now = this.clock.now();
    return withTransaction(
      this.deps.prisma,
      async (tx) => {
        const row = await tx.aiDataUseAcknowledgement.findFirst({
          where: { tenantId: actor.tenantId, id: acknowledgementId },
        });
        if (!row) throw new AppError('RESOURCE_NOT_FOUND');
        await this.authorize(tx, actor, row.doctorProfileId);
        if (row.revokedAt) return ackView(row);
        const updated = await this.revokeRow(tx, actor, row, 'DOCTOR_WITHDREW', now);
        return ackView(updated);
      },
      { context: 'ai:ack:withdraw' },
    );
  }

  /**
   * Revokes a row and returns every credential that depended on it to `PENDING_VALIDATION`.
   *
   * The two go together. A credential whose acknowledgement no longer holds must not stay `ACTIVE`,
   * because the policy engine would otherwise read a live credential while the statement behind it had
   * been withdrawn.
   */
  private async revokeRow(
    tx: Tx,
    actor: AIAcknowledgementActor,
    row: AckRow,
    reason: 'TEXT_VERSION_SUPERSEDED' | 'DOCTOR_WITHDREW',
    now: Date,
  ): Promise<AckRow> {
    const updated = await tx.aiDataUseAcknowledgement.update({
      where: { id: row.id },
      data: {
        revokedAt: now,
        revokeReason: reason,
        updatedAt: now,
        updatedByUserId: actor.userId,
        rowVersion: { increment: 1 },
      },
    });
    const dependent = await tx.aiProviderCredential.findMany({
      where: {
        tenantId: actor.tenantId,
        dataUseAckId: row.id,
        status: { in: ['ACTIVE', 'INVALID', 'QUOTA_EXHAUSTED'] },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    for (const credential of dependent) {
      await lockRow(tx, 'ai_provider_credentials', credential.id, actor.tenantId);
      await tx.aiProviderCredential.update({
        where: { id: credential.id },
        data: {
          status: 'PENDING_VALIDATION',
          updatedAt: now,
          updatedByUserId: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
    }
    await this.deps.audit.append(tx, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      actorType: 'USER',
      action: 'AI_DATA_USE_ACK_REVOKED',
      resourceType: 'ai_data_use_acknowledgement',
      resourceId: row.id,
      outcome: 'SUCCESS',
      requestId: actor.requestId ?? null,
      metadata: {
        doctorProfileId: row.doctorProfileId,
        providerCode: row.providerCode,
        tier: row.tier,
        reason,
        credentialsReturnedToPending: dependent.length,
      },
    });
    return updated;
  }
}
