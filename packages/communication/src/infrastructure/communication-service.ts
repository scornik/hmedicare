import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError, type Clock, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, type Tx, lockRow, withTransaction } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import { OutboxPort, NonRetryableJobError, RateLimitedJobError } from '@hmedic/jobs';
import type {
  CommunicationProvider,
  ProviderSendResult,
  ProviderReceipt,
  WebhookInput,
} from '../application/ports/communication-provider';
import type {
  CommunicationRecipientSource,
  CommunicationReminderSource,
} from '../application/ports/communication-source';

const CreateReminder = z
  .object({
    tenantId: z.string().uuid(),
    patientId: z.string().uuid(),
    planId: z.string().uuid(),
    channel: z.enum(['email', 'whatsapp']),
    locale: z.enum(['en-BD', 'bn-BD']),
    idempotencyKey: z.string().min(1).max(191),
    task: z.object({ id: z.string().uuid(), rowVersion: z.number().int().positive() }).strict().optional(),
  })
  .strict();
type ReminderInput = z.infer<typeof CreateReminder>;
const terminal = new Set(['SENT', 'DELIVERED', 'READ', 'FAILED', 'CANCELLED']);
const message = (locale: string) =>
  locale === 'bn-BD'
    ? 'আপনার ফলো-আপের অনুস্মারক আছে। বিস্তারিত দেখতে HMedic-এ লগইন করুন।'
    : 'You have a follow-up reminder. Log in to HMedic for details.';

/** Internal application facade. Callers must authorize patient/source access before requesting an intent. */
export interface CommunicationActor {
  userId: string;
  actingAs?: 'SELF' | 'GUARDIAN';
  requestId?: string;
}
export class CommunicationService {
  private readonly outbox: OutboxPort;
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: PrismaAuditPort,
    private readonly recipients: CommunicationRecipientSource<Tx>,
    private readonly reminders: CommunicationReminderSource<Tx>,
    private readonly providers: ReadonlyMap<string, CommunicationProvider>,
    private readonly clock: Clock = systemClock,
  ) {
    this.outbox = new OutboxPort(clock);
  }
  private async preference(tx: Tx, tenantId: string, patientId: string, channel: string) {
    return tx.communicationPreference.findFirst({
      where: {
        tenantId,
        patientId,
        channel,
        effectiveFrom: { lte: this.clock.now() },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: this.clock.now() } }],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
    });
  }
  private async recipient(tx: Tx, tenantId: string, patientId: string, channel: 'email' | 'whatsapp') {
    // Patient lock serializes preference mutations and contact selection; recipient owner takes it again safely.
    if (!(await lockRow(tx, 'patients', patientId, tenantId))) return null;
    const preference = await this.preference(tx, tenantId, patientId, channel);
    if (preference?.preference === 'OPT_OUT') return null;
    const recipient = await this.recipients.resolve(tx, tenantId, patientId, channel, preference?.contactId);
    if (preference && recipient && recipient.consentVersion < preference.consentVersion) return null;
    return recipient;
  }
  private async record(tx: Tx, tenantId: string, id: string, status: string, eventName: string) {
    await this.outbox.append(tx, {
      eventName,
      eventVersion: 1,
      tenantId,
      aggregateType: 'communication',
      aggregateId: id,
      correlationId: newId(),
      causationId: null,
      actorId: null,
      idempotencyKey: null,
      payload: { communicationId: id, status },
    });
    await this.audit.append(tx, {
      tenantId,
      actorUserId: null,
      actorType: 'SYSTEM',
      action: eventName.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase(),
      resourceType: 'communication',
      resourceId: id,
      outcome: 'SUCCESS',
      requestId: null,
      correlationId: null,
      metadata: { status },
    });
  }
  async requestReminder(raw: ReminderInput) {
    const parsed = CreateReminder.safeParse(raw);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED');
    const input = parsed.data;
    if (!this.providers.has(input.channel)) throw new AppError('FEATURE_DISABLED');
    return withTransaction(this.prisma, async (tx) => {
      if (!(await lockRow(tx, 'patients', input.patientId, input.tenantId)))
        throw new AppError('RESOURCE_NOT_FOUND');
      const previous = await tx.communication.findUnique({
        where: {
          tenantId_idempotencyKey: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey },
        },
      });
      if (previous) {
        if (
          previous.patientId !== input.patientId ||
          previous.businessId !== input.planId ||
          previous.channel !== input.channel ||
          previous.locale !== input.locale
        )
          throw new AppError('IDEMPOTENCY_KEY_REUSED');
        return previous;
      }
      const recipient = await this.recipient(tx, input.tenantId, input.patientId, input.channel);
      const eligible = await this.reminders.eligible(
        tx,
        input.tenantId,
        input.patientId,
        input.planId,
        input.task,
      );
      const status = recipient && eligible ? 'QUEUED' : 'CANCELLED';
      const now = this.clock.now();
      const row = await tx.communication.create({
        data: {
          id: newId(),
          tenantId: input.tenantId,
          patientId: input.patientId,
          channel: input.channel,
          purpose: 'follow_up_reminder',
          templateKey: 'follow_up_reminder',
          templateVersion: 1,
          locale: input.locale,
          consentId: recipient?.consentId ?? null,
          businessType: 'follow_up_plan',
          businessId: input.planId,
          status,
          idempotencyKey: input.idempotencyKey,
          createdAt: now,
          updatedAt: now,
        },
      });
      await this.record(
        tx,
        input.tenantId,
        row.id,
        status,
        status === 'QUEUED' ? 'CommunicationDeliveryRequested' : 'CommunicationCancelled',
      );
      return row;
    });
  }
  async list(tenantId: string, patientId: string, actor: CommunicationActor) {
    const rows = await this.prisma.communication.findMany({
      where: { tenantId, patientId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
      select: {
        id: true,
        channel: true,
        purpose: true,
        status: true,
        businessType: true,
        businessId: true,
        createdAt: true,
        updatedAt: true,
        rowVersion: true,
      },
    });
    await withTransaction(this.prisma, (tx) =>
      this.audit.append(tx, {
        tenantId,
        actorUserId: actor.userId,
        actorType: actor.actingAs ? 'PATIENT_CONTEXT' : 'USER',
        actingAs: actor.actingAs ?? null,
        onBehalfOfPatientId: actor.actingAs ? patientId : null,
        action: 'COMMUNICATION_READ',
        resourceType: 'patient',
        resourceId: patientId,
        outcome: 'SUCCESS',
        requestId: actor.requestId ?? null,
        correlationId: actor.requestId ?? null,
        metadata: { count: rows.length },
      }),
    );
    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }
  async preferences(tenantId: string, patientId: string, actor?: CommunicationActor) {
    const rows = await this.prisma.communicationPreference.findMany({
      where: {
        tenantId,
        patientId,
        effectiveFrom: { lte: this.clock.now() },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: this.clock.now() } }],
      },
      orderBy: [{ channel: 'asc' }, { effectiveFrom: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    if (actor)
      await withTransaction(this.prisma, (tx) =>
        this.audit.append(tx, {
          tenantId,
          actorUserId: actor.userId,
          actorType: actor.actingAs ? 'PATIENT_CONTEXT' : 'USER',
          actingAs: actor.actingAs ?? null,
          onBehalfOfPatientId: actor.actingAs ? patientId : null,
          action: 'COMMUNICATION_PREFERENCES_READ',
          resourceType: 'patient',
          resourceId: patientId,
          outcome: 'SUCCESS',
          requestId: actor.requestId ?? null,
          correlationId: actor.requestId ?? null,
          metadata: { count: rows.length },
        }),
      );
    return rows;
  }
  /** Set through an authorized controller/context. OPT_IN never substitutes for a consent grant. */
  async setPreference(
    tenantId: string,
    patientId: string,
    channel: 'email' | 'whatsapp',
    preference: 'OPT_IN' | 'OPT_OUT',
    consentVersion: number,
    contactId: string | null = null,
    actor?: CommunicationActor,
  ) {
    if (
      !['email', 'whatsapp'].includes(channel) ||
      !['OPT_IN', 'OPT_OUT'].includes(preference) ||
      !Number.isInteger(consentVersion) ||
      consentVersion < 1
    )
      throw new AppError('VALIDATION_FAILED');
    return withTransaction(this.prisma, async (tx) => {
      if (!(await lockRow(tx, 'patients', patientId, tenantId))) throw new AppError('RESOURCE_NOT_FOUND');
      if (contactId && !(await this.recipients.validContact(tx, tenantId, patientId, channel, contactId)))
        throw new AppError('VALIDATION_FAILED');
      const current = await this.preference(tx, tenantId, patientId, channel);
      if (
        current &&
        current.preference === preference &&
        current.consentVersion === consentVersion &&
        current.contactId === contactId
      )
        return current;
      const now = this.clock.now();
      await tx.communicationPreference.updateMany({
        where: { tenantId, patientId, channel, effectiveTo: null },
        data: { effectiveTo: now, updatedAt: now, rowVersion: { increment: 1 } },
      });
      const created = await tx.communicationPreference.create({
        data: {
          id: newId(),
          tenantId,
          patientId,
          channel,
          preference,
          contactId,
          consentVersion,
          effectiveFrom: now,
          createdAt: now,
          updatedAt: now,
        },
      });
      await this.audit.append(tx, {
        tenantId,
        actorUserId: actor?.userId ?? null,
        actorType: actor?.actingAs ? 'PATIENT_CONTEXT' : actor ? 'USER' : 'SYSTEM',
        actingAs: actor?.actingAs ?? null,
        onBehalfOfPatientId: actor?.actingAs ? patientId : null,
        action: 'COMMUNICATION_PREFERENCE_CHANGED',
        resourceType: 'communication_preference',
        resourceId: created.id,
        outcome: 'SUCCESS',
        requestId: actor?.requestId ?? null,
        correlationId: actor?.requestId ?? null,
        metadata: { channel, preference, patientId },
      });
      return created;
    });
  }
  async deliver(tenantId: string, id: string, signal?: AbortSignal, executionAttempt = 1): Promise<void> {
    if (signal?.aborted) return;
    const snapshot = await this.prisma.communication.findFirst({ where: { tenantId, id } });
    if (!snapshot || terminal.has(snapshot.status)) return;
    const supported = !!snapshot.patientId && ['email', 'whatsapp'].includes(snapshot.channel);
    const provider = supported ? this.providers.get(snapshot.channel) : undefined;
    if (!provider) {
      await withTransaction(this.prisma, async (tx) => {
        if (!(await lockRow(tx, 'communications', id, tenantId))) return;
        const current = await tx.communication.findFirstOrThrow({ where: { tenantId, id } });
        if (terminal.has(current.status) || current.rowVersion !== snapshot.rowVersion) return;
        const sending = await tx.communicationAttempt.findFirst({
          where: { tenantId, communicationId: id, status: 'SENDING' },
          orderBy: { attemptNumber: 'desc' },
        });
        const now = this.clock.now();
        if (sending) {
          await lockRow(tx, 'communication_attempts', sending.id, tenantId);
          await tx.communicationAttempt.update({
            where: { id: sending.id },
            data: {
              status: 'UNKNOWN',
              errorClass: 'UNKNOWN_OUTCOME',
              outcomeClass: 'UNKNOWN_OUTCOME',
              updatedAt: now,
              rowVersion: { increment: 1 },
            },
          });
        }
        await tx.communication.update({
          where: { id },
          data: { status: 'FAILED', updatedAt: now, rowVersion: { increment: 1 } },
        });
        await this.record(tx, tenantId, id, 'FAILED', 'CommunicationFailed');
      });
      throw new NonRetryableJobError(
        supported ? 'COMMUNICATION_PROVIDER_UNAVAILABLE' : 'COMMUNICATION_CHANNEL_UNSUPPORTED',
      );
    }
    const prepared = await withTransaction(this.prisma, async (tx) => {
      const recipient = await this.recipient(
        tx,
        tenantId,
        snapshot.patientId!,
        snapshot.channel as 'email' | 'whatsapp',
      );
      const eligible = await this.reminders.eligible(tx, tenantId, snapshot.patientId!, snapshot.businessId);
      if (!(await lockRow(tx, 'communications', id, tenantId))) return null;
      const current = await tx.communication.findFirstOrThrow({ where: { tenantId, id } });
      if (terminal.has(current.status)) return null;
      if (!recipient || !eligible) {
        await tx.communication.update({
          where: { id },
          data: { status: 'CANCELLED', updatedAt: this.clock.now(), rowVersion: { increment: 1 } },
        });
        await this.record(tx, tenantId, id, 'CANCELLED', 'CommunicationCancelled');
        return null;
      }
      let attempt = await tx.communicationAttempt.findFirst({
        where: { tenantId, communicationId: id },
        orderBy: { attemptNumber: 'desc' },
      });
      if (attempt?.status === 'SENDING') {
        if (attempt.providerAdapter !== provider.code)
          throw new NonRetryableJobError('COMMUNICATION_PROVIDER_CHANGED');
      } else {
        const number = (attempt?.attemptNumber ?? 0) + 1;
        if (number > 65535) throw new NonRetryableJobError('COMMUNICATION_ATTEMPTS_EXHAUSTED');
        attempt = await tx.communicationAttempt.create({
          data: {
            id: newId(),
            tenantId,
            communicationId: id,
            attemptNumber: number,
            providerAdapter: provider.code,
            status: 'SENDING',
            createdAt: this.clock.now(),
            updatedAt: this.clock.now(),
          },
        });
      }
      const sending = await tx.communication.update({
        where: { id },
        data: {
          status: 'SENDING',
          consentId: recipient.consentId,
          updatedAt: this.clock.now(),
          rowVersion: { increment: 1 },
        },
      });
      return { recipient, attempt, communication: sending };
    });
    if (!prepared || signal?.aborted) return;
    let result: ProviderSendResult;
    try {
      result = await provider.send({
        tenantId,
        communicationId: id,
        attemptId: prepared.attempt.id,
        idempotencyKey: prepared.attempt.id,
        destination: prepared.recipient.destination,
        text: message(prepared.communication.locale),
        locale: prepared.communication.locale,
      });
    } catch {
      // The call may have been accepted. Keep the same attempt/key for reconciliation/replay.
      if (executionAttempt >= 5 && !signal?.aborted) {
        await withTransaction(this.prisma, async (tx) => {
          await lockRow(tx, 'communications', id, tenantId);
          await lockRow(tx, 'communication_attempts', prepared.attempt.id, tenantId);
          const current = await tx.communication.findFirstOrThrow({ where: { tenantId, id } });
          if (terminal.has(current.status) || current.rowVersion !== prepared.communication.rowVersion)
            return;
          const now = this.clock.now();
          await tx.communicationAttempt.update({
            where: { id: prepared.attempt.id },
            data: {
              status: 'UNKNOWN',
              errorClass: 'UNKNOWN_OUTCOME',
              outcomeClass: 'UNKNOWN_OUTCOME',
              updatedAt: now,
              rowVersion: { increment: 1 },
            },
          });
          await tx.communication.update({
            where: { id },
            data: { status: 'FAILED', updatedAt: now, rowVersion: { increment: 1 } },
          });
          await this.record(tx, tenantId, id, 'FAILED', 'CommunicationFailed');
        });
        throw new NonRetryableJobError('COMMUNICATION_PROVIDER_OUTCOME_UNKNOWN');
      }
      throw Object.assign(new Error('COMMUNICATION_PROVIDER_OUTCOME_UNKNOWN'), { code: 'UNKNOWN_OUTCOME' });
    }
    if (signal?.aborted) return;
    const state = await withTransaction(this.prisma, async (tx) => {
      if (!(await lockRow(tx, 'communications', id, tenantId))) return null;
      if (!(await lockRow(tx, 'communication_attempts', prepared.attempt.id, tenantId))) return null;
      const current = await tx.communication.findFirstOrThrow({ where: { tenantId, id } });
      const attempt = await tx.communicationAttempt.findFirstOrThrow({
        where: { tenantId, id: prepared.attempt.id },
      });
      if (
        terminal.has(current.status) ||
        attempt.status !== 'SENDING' ||
        current.rowVersion !== prepared.communication.rowVersion ||
        attempt.rowVersion !== prepared.attempt.rowVersion
      )
        return null;
      const failedCount = await tx.communicationAttempt.count({
        where: { tenantId, communicationId: id, errorClass: 'PROVIDER_UNAVAILABLE' },
      });
      const status =
        result.outcome === 'ACCEPTED'
          ? 'SENT'
          : result.outcome === 'PERMANENT_FAILURE' ||
              (result.outcome === 'TRANSIENT_FAILURE' && failedCount >= 4)
            ? 'FAILED'
            : 'RETRY_SCHEDULED';
      const errorClass =
        result.outcome === 'ACCEPTED'
          ? null
          : result.outcome === 'RATE_LIMITED'
            ? 'RATE_LIMITED'
            : result.errorClass;
      const now = this.clock.now();
      await tx.communicationAttempt.update({
        where: { id: attempt.id },
        data: {
          status: result.outcome === 'ACCEPTED' ? 'SENT' : 'FAILED',
          providerMessageId: result.outcome === 'ACCEPTED' ? result.providerMessageId : null,
          errorClass,
          outcomeClass:
            result.outcome === 'ACCEPTED'
              ? 'ACCEPTED'
              : result.outcome === 'RATE_LIMITED'
                ? 'RATE_LIMITED'
                : result.outcome === 'TRANSIENT_FAILURE'
                  ? 'PROVIDER_UNAVAILABLE'
                  : 'REJECTED',
          sentAt: result.outcome === 'ACCEPTED' ? now : null,
          failedAt: result.outcome === 'ACCEPTED' ? null : now,
          updatedAt: now,
          rowVersion: { increment: 1 },
        },
      });
      await tx.communication.update({
        where: { id },
        data: { status, updatedAt: now, rowVersion: { increment: 1 } },
      });
      await this.record(
        tx,
        tenantId,
        id,
        status,
        status === 'SENT'
          ? 'CommunicationSent'
          : status === 'FAILED'
            ? 'CommunicationFailed'
            : 'CommunicationRetryScheduled',
      );
      return status;
    });
    if (state === 'RETRY_SCHEDULED') {
      if (result.outcome === 'RATE_LIMITED')
        throw new RateLimitedJobError(new Date(this.clock.now().getTime() + result.retryAfterSeconds * 1000));
      throw Object.assign(new Error('COMMUNICATION_PROVIDER_UNAVAILABLE'), { code: 'PROVIDER_UNAVAILABLE' });
    }
    if (state === 'FAILED') throw new NonRetryableJobError('COMMUNICATION_DELIVERY_FAILED');
  }
  async receiveWebhook(
    provider: CommunicationProvider,
    input: WebhookInput,
  ): Promise<ProviderReceipt | null> {
    const receipt = await provider.verifyWebhook(input);
    if (!receipt || receipt.providerAdapter !== provider.code) return null;
    await withTransaction(this.prisma, async (tx) => {
      const ref = await tx.communicationAttempt.findUnique({
        where: {
          providerAdapter_providerMessageId: {
            providerAdapter: receipt.providerAdapter,
            providerMessageId: receipt.providerMessageId,
          },
        },
      });
      if (ref) {
        await lockRow(tx, 'communications', ref.communicationId, ref.tenantId);
        await lockRow(tx, 'communication_attempts', ref.id, ref.tenantId);
      }
      const payloadSha256 = createHash('sha256').update(input.rawBody).digest('hex');
      const inserted = await tx.providerWebhookEvent.createMany({
        skipDuplicates: true,
        data: [
          {
            id: newId(),
            providerAdapter: receipt.providerAdapter,
            providerEventId: receipt.providerEventId,
            receivedAt: this.clock.now(),
            signatureValid: true,
            payloadSha256,
            tenantId: ref?.tenantId ?? null,
            mappedAttemptId: ref?.id ?? null,
          },
        ],
      });
      if (!inserted.count) {
        const stored = await tx.providerWebhookEvent.findUniqueOrThrow({
          where: {
            providerAdapter_providerEventId: {
              providerAdapter: receipt.providerAdapter,
              providerEventId: receipt.providerEventId,
            },
          },
        });
        // Preserve the append-only ledger. An unmatched receipt may be replayed once its attempt is known;
        // the monotonic transition + audit/outbox records acknowledge mapping without editing this row.
        if (stored.payloadSha256 !== payloadSha256 || stored.mappedAttemptId) return;
      }
      if (!ref) return;
      const attempt = await tx.communicationAttempt.findFirstOrThrow({
        where: { id: ref.id, tenantId: ref.tenantId },
      });
      const comm = await tx.communication.findFirstOrThrow({
        where: { id: ref.communicationId, tenantId: ref.tenantId },
      });
      const rank: Record<string, number> = { SENT: 1, DELIVERED: 2, READ: 3 };
      const advance =
        (rank[receipt.status] ?? 0) > (rank[attempt.status] ?? 0) &&
        ['SENT', 'DELIVERED', 'READ'].includes(attempt.status) &&
        ['SENT', 'DELIVERED', 'READ'].includes(comm.status);
      const failedReceipt =
        receipt.status === 'FAILED' && attempt.status === 'SENT' && comm.status === 'SENT';
      if (advance || failedReceipt) {
        const now = this.clock.now();
        await tx.communicationAttempt.update({
          where: { id: ref.id },
          data: {
            status: receipt.status,
            ...(receipt.status === 'DELIVERED'
              ? { deliveredAt: now }
              : receipt.status === 'READ'
                ? { readAt: now }
                : failedReceipt
                  ? { failedAt: now }
                  : {}),
            updatedAt: now,
            rowVersion: { increment: 1 },
          },
        });
        await tx.communication.update({
          where: { id: comm.id },
          data: { status: receipt.status, updatedAt: now, rowVersion: { increment: 1 } },
        });
        await this.record(tx, ref.tenantId, comm.id, receipt.status, 'CommunicationReceiptRecorded');
      }
    });
    return receipt;
  }
}
