import { AppError, type Clock, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, type Tx, lockRow, withTransaction } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import {
  type JobPort,
  OutboxPort,
  type RateLimiter,
  NonRetryableJobError,
  RateLimitedJobError,
} from '@hmedic/jobs';
import type { Metrics } from '@hmedic/observability';
import type { ProviderCredentialVault } from '@hmedic/provider-credentials';
import type {
  CommunicationRecipientSource,
  CommunicationReminderSource,
} from '../application/ports/communication-source';
import type { SmsCredentialHandle, SmsProvider, SmsSendResult } from '../application/sms-ports';
import { renderTemplate, type SmsLocale } from '../domain/sms-templates';
import { transactionalSmsDecision } from './transactional-sms-policy';

export const DELIVER_TRANSACTIONAL_SMS = 'DeliverTransactionalSms';
export interface SmsJobIdentity {
  communicationId: string;
  credentialScope: 'PLATFORM' | 'TENANT';
  credentialId: string | null;
}
export interface TransactionalSmsDeps {
  prisma: PrismaClient;
  audit: PrismaAuditPort;
  provider: SmsProvider;
  platform: SmsCredentialHandle;
  vault: ProviderCredentialVault;
  rateLimiter: RateLimiter;
  maxSendsPerMinute: number;
  metrics?: Metrics;
  clock?: Clock;
  reminderLinks?: {
    issuer: { issue(tenantId: string, communicationId: string): Promise<{ token: string }> };
    webPublicUrl: string;
  };
}
const terminal = new Set(['SENT', 'DELIVERED', 'READ', 'FAILED', 'CANCELLED']);
/** Dedicated non-idempotent SMS path. Payloads hold IDs; contact and secret resolution stays in process. */
export class TransactionalSmsDelivery {
  private jobs: JobPort | null = null;
  private readonly clock: Clock;
  private readonly outbox: OutboxPort;
  constructor(
    private readonly deps: TransactionalSmsDeps,
    private readonly recipients: CommunicationRecipientSource<Tx>,
    private readonly reminders: CommunicationReminderSource<Tx>,
  ) {
    this.clock = deps.clock ?? systemClock;
    this.outbox = new OutboxPort(this.clock);
  }
  bindQueue(jobs: JobPort) {
    if (this.jobs) throw new Error('SMS queue already bound');
    this.jobs = jobs;
  }
  private async selected(tenantId: string) {
    const selected = await this.deps.vault.selectTransactionalSms(tenantId);
    if (selected.scope === 'PLATFORM_ACCOUNT')
      return { scope: 'PLATFORM' as const, id: null, status: 'ACTIVE', credential: this.deps.platform };
    const handle = selected.handle;
    const credential: SmsCredentialHandle | null = handle
      ? {
          scope: 'TENANT',
          credentialId: handle.credentialId,
          tenantId,
          senderId: handle.publicIdentifier ?? '',
          withKey: (fn) => handle.use((bundle) => fn(bundle.apiKey ?? '')),
        }
      : null;
    return { scope: 'TENANT' as const, id: selected.credentialId, status: selected.status, credential };
  }
  async enqueue(tenantId: string, id: string) {
    if (!this.jobs) throw new NonRetryableJobError('SMS_QUEUE_UNAVAILABLE');
    const selected = await this.selected(tenantId);
    const identity: SmsJobIdentity = {
      communicationId: id,
      credentialScope: selected.scope,
      credentialId: selected.id,
    };
    await this.jobs.enqueue({
      type: DELIVER_TRANSACTIONAL_SMS,
      tenantId,
      payload: { v: 1, ...identity },
      concurrencyKey: `sms:${selected.scope}:${selected.id ?? 'platform'}`,
      idempotencyKey: `transactional-sms:${id}`,
      correlationId: newId(),
    });
  }
  private async record(tx: Tx, tenantId: string, id: string, status: string, errorClass?: string) {
    const eventName =
      status === 'SENT'
        ? 'CommunicationSent'
        : status === 'CANCELLED'
          ? 'CommunicationCancelled'
          : status === 'FAILED'
            ? 'CommunicationFailed'
            : 'CommunicationRetryScheduled';
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
    await this.deps.audit.append(tx, {
      tenantId,
      actorUserId: null,
      actorType: 'SYSTEM',
      action: eventName.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase(),
      resourceType: 'communication',
      resourceId: id,
      outcome: 'SUCCESS',
      metadata: { status, ...(errorClass ? { errorClass } : {}) },
    });
  }
  private async fail(tenantId: string, id: string, errorClass: string) {
    await withTransaction(this.deps.prisma, async (tx) => {
      if (!(await lockRow(tx, 'communications', id, tenantId))) return;
      const row = await tx.communication.findFirstOrThrow({ where: { tenantId, id } });
      if (terminal.has(row.status)) return;
      const now = this.clock.now();
      await tx.communicationAttempt.updateMany({
        where: { tenantId, communicationId: id, status: 'SENDING' },
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
      await this.record(tx, tenantId, id, 'FAILED', errorClass);
    });
    throw new NonRetryableJobError(errorClass);
  }
  async execute(tenantId: string, identity: SmsJobIdentity, signal?: AbortSignal) {
    if (signal?.aborted) return;
    const { prisma } = this.deps,
      id = identity.communicationId;
    const snapshot = await prisma.communication.findFirst({ where: { tenantId, id } });
    if (!snapshot || terminal.has(snapshot.status)) return;
    if (
      snapshot.channel !== 'sms' ||
      !snapshot.patientId ||
      snapshot.purpose !== 'follow_up_reminder' ||
      snapshot.businessType !== 'follow_up_plan'
    )
      return this.fail(tenantId, id, 'SMS_PURPOSE_UNSUPPORTED');
    const selected = await this.selected(tenantId);
    if (selected.scope !== identity.credentialScope || selected.id !== identity.credentialId)
      return this.fail(tenantId, id, 'SMS_CREDENTIAL_CHANGED');
    if (!selected.credential && selected.status !== 'SUSPENDED_BALANCE')
      return this.fail(tenantId, id, 'SMS_CREDENTIAL_UNUSABLE');
    const balanceFailure = await prisma.communicationAttempt.findFirst({
      where: { tenantId, communicationId: id, errorClass: 'INSUFFICIENT_BALANCE' },
      orderBy: { attemptNumber: 'asc' },
    });
    if (balanceFailure && this.clock.now().getTime() - balanceFailure.createdAt.getTime() >= 86400000)
      return this.fail(tenantId, id, 'SMS_BALANCE_WAIT_EXPIRED');
    // Balance checks, not blind resends, reactivate tenant credentials. These waits consume no send attempt.
    if (balanceFailure && !selected.credential)
      throw new RateLimitedJobError(new Date(this.clock.now().getTime() + 300000));
    if (balanceFailure && selected.credential) {
      // A resumed account must pass a free balance check before another paid send.
      let balance;
      try {
        balance = await this.deps.provider.checkBalance(selected.credential);
      } catch {
        throw new RateLimitedJobError(new Date(this.clock.now().getTime() + 300000));
      }
      if (
        balance.outcome === 'REJECTED' &&
        ['INVALID_CREDENTIAL', 'SENDER_ID_INVALID'].includes(balance.errorClass)
      ) {
        if (selected.id)
          await this.deps.vault.setStatus(tenantId, selected.id, 'INVALID', balance.errorClass);
        return this.fail(tenantId, id, balance.errorClass);
      }
      if (
        balance.outcome !== 'OK' ||
        balance.parseStatus !== 'PARSED' ||
        balance.balance === null ||
        Number(balance.balance) <= 0
      )
        throw new RateLimitedJobError(new Date(this.clock.now().getTime() + 300000));
    }
    let text: string;
    try {
      if (!['bn-BD', 'en-BD'].includes(snapshot.locale)) throw Error('locale');
      text = renderTemplate(
        snapshot.templateKey,
        snapshot.locale as SmsLocale,
        { appName: 'HMedic', shortLink: '' },
        snapshot.templateVersion,
      ).trim();
    } catch {
      return this.fail(tenantId, id, 'SMS_TEMPLATE_INVALID');
    }
    const rate = await this.deps.rateLimiter.consume(
      { scope: 'sms:transactional', limit: this.deps.maxSendsPerMinute, windowSeconds: 60 },
      `sms:${selected.scope}:${selected.id ?? 'platform'}`,
    );
    if (!rate.allowed)
      throw new RateLimitedJobError(new Date(this.clock.now().getTime() + rate.retryAfterSeconds * 1000));
    if (this.deps.reminderLinks) {
      // Issue in a separate transaction before preparation: both lock the same patient/source.
      // Rate-limited jobs create no links. Preparation still rechecks consent and source afterward.
      let token: string;
      try {
        token = (await this.deps.reminderLinks.issuer.issue(tenantId, id)).token;
      } catch (error) {
        if (error instanceof AppError && error.code === 'RESOURCE_NOT_FOUND')
          return this.fail(tenantId, id, 'SMS_SOURCE_INELIGIBLE');
        throw error;
      }
      try {
        const url = new URL(this.deps.reminderLinks.webPublicUrl);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
          throw Error('reminder URL');
        url.pathname = `/r/${token}`;
        url.search = '';
        url.hash = '';
        text = renderTemplate(
          snapshot.templateKey,
          snapshot.locale as SmsLocale,
          { appName: 'HMedic', shortLink: url.toString() },
          snapshot.templateVersion,
        ).trim();
      } catch {
        return this.fail(tenantId, id, 'SMS_TEMPLATE_INVALID');
      }
    }
    const prepared = await withTransaction(prisma, async (tx) => {
      if (!(await lockRow(tx, 'patients', snapshot.patientId!, tenantId))) return null;
      const preference = await tx.communicationPreference.findFirst({
        where: {
          tenantId,
          patientId: snapshot.patientId!,
          channel: 'sms',
          effectiveFrom: { lte: this.clock.now() },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: this.clock.now() } }],
        },
        orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
      });
      const recipient =
        preference?.preference === 'OPT_OUT'
          ? null
          : await this.recipients.resolve(tx, tenantId, snapshot.patientId!, 'sms', preference?.contactId);
      const eligible = await this.reminders.eligible(tx, tenantId, snapshot.patientId!, snapshot.businessId);
      if (!(await lockRow(tx, 'communications', id, tenantId))) return null;
      const current = await tx.communication.findFirstOrThrow({ where: { tenantId, id } });
      if (terminal.has(current.status)) return null;
      if (!recipient || !eligible || (preference && recipient.consentVersion < preference.consentVersion)) {
        await tx.communication.update({
          where: { id },
          data: { status: 'CANCELLED', updatedAt: this.clock.now(), rowVersion: { increment: 1 } },
        });
        await this.record(tx, tenantId, id, 'CANCELLED');
        return null;
      }
      const latest = await tx.communicationAttempt.findFirst({
        where: { tenantId, communicationId: id },
        orderBy: { attemptNumber: 'desc' },
      });
      const now = this.clock.now();
      if (latest?.status === 'SENDING') {
        // A live/overlapping worker may still be in its provider call. Never immediately resend.
        if (now.getTime() - latest.createdAt.getTime() < 240000)
          throw new RateLimitedJobError(new Date(latest.createdAt.getTime() + 240000));
        await tx.communicationAttempt.update({
          where: { id: latest.id },
          data: {
            status: 'UNKNOWN',
            errorClass: 'UNKNOWN_OUTCOME',
            outcomeClass: 'UNKNOWN_OUTCOME',
            updatedAt: now,
            rowVersion: { increment: 1 },
          },
        });
        latest.status = 'UNKNOWN';
        latest.errorClass = 'UNKNOWN_OUTCOME';
      }
      const history = {
        unknownOutcomes: await tx.communicationAttempt.count({
          where: { tenantId, communicationId: id, status: 'UNKNOWN' },
        }),
        unavailableFailures: await tx.communicationAttempt.count({
          where: { tenantId, communicationId: id, errorClass: 'PROVIDER_UNAVAILABLE' },
        }),
        balanceSuspendedSince: balanceFailure?.createdAt ?? null,
      };
      if (history.unknownOutcomes >= 2 || history.unavailableFailures >= 5) {
        const status = history.unknownOutcomes >= 2 ? 'SENT' : 'FAILED';
        await tx.communication.update({
          where: { id },
          data: { status, updatedAt: now, rowVersion: { increment: 1 } },
        });
        await this.record(tx, tenantId, id, status);
        return null;
      }
      const number = (latest?.attemptNumber ?? 0) + 1;
      if (number > 65535) throw new NonRetryableJobError('SMS_ATTEMPTS_EXHAUSTED');
      const attempt = await tx.communicationAttempt.create({
        data: {
          id: newId(),
          tenantId,
          communicationId: id,
          attemptNumber: number,
          providerAdapter: this.deps.provider.code === 'mock' ? 'mock-sms' : this.deps.provider.code,
          status: 'SENDING',
          smsCredentialScope: selected.scope,
          smsCredentialId: selected.id,
          possibleDuplicate: history.unknownOutcomes > 0,
          createdAt: now,
          updatedAt: now,
        },
      });
      const communication = await tx.communication.update({
        where: { id },
        data: {
          status: 'SENDING',
          consentId: recipient.consentId,
          updatedAt: now,
          rowVersion: { increment: 1 },
        },
      });
      return { recipient, attempt, communication, history };
    });
    if (!prepared || signal?.aborted) return;
    const started = Date.now();
    let result: SmsSendResult;
    try {
      result = selected.credential
        ? await this.deps.provider.send({
            credential: selected.credential,
            destination: prepared.recipient.destination,
            text,
            purpose: 'TRANSACTIONAL',
            correlationId: prepared.attempt.id,
          })
        : { outcome: 'REJECTED', errorClass: 'INSUFFICIENT_BALANCE' };
    } catch {
      result = { outcome: 'UNKNOWN_OUTCOME', errorClass: 'UNKNOWN_OUTCOME' };
    }
    if (selected.credential) {
      this.deps.metrics?.smsSend.inc({
        provider: this.deps.provider.code,
        purpose: 'TRANSACTIONAL',
        outcome: result.outcome,
        error_class: result.outcome === 'ACCEPTED' ? 'none' : result.errorClass,
        credential_scope: selected.scope,
      });
      this.deps.metrics?.smsLatency.observe(
        { provider: this.deps.provider.code, operation: 'send' },
        (Date.now() - started) / 1000,
      );
      if (result.outcome === 'ACCEPTED')
        this.deps.metrics?.smsSegments.inc(
          { encoding: result.encoding, credential_scope: selected.scope },
          result.segmentsEstimated,
        );
    }
    if (signal?.aborted) return;
    const decision = transactionalSmsDecision(result, prepared.history, this.clock.now());
    const committed = await withTransaction(prisma, async (tx) => {
      if (!(await lockRow(tx, 'communications', id, tenantId))) return false;
      await lockRow(tx, 'communication_attempts', prepared.attempt.id, tenantId);
      const current = await tx.communication.findFirstOrThrow({ where: { tenantId, id } });
      const attempt = await tx.communicationAttempt.findFirstOrThrow({
        where: { tenantId, id: prepared.attempt.id },
      });
      if (
        current.rowVersion !== prepared.communication.rowVersion ||
        terminal.has(current.status) ||
        attempt.status !== 'SENDING'
      )
        return false;
      const now = this.clock.now();
      await tx.communicationAttempt.update({
        where: { id: attempt.id },
        data: {
          status: decision.attemptStatus,
          errorClass: result.outcome === 'ACCEPTED' ? null : result.errorClass,
          outcomeClass: result.outcome,
          providerMessageId:
            result.outcome === 'ACCEPTED'
              ? this.deps.provider.code === 'mock'
                ? `mock-sms:${attempt.id}`
                : result.providerMessageId && result.providerMessageId.length <= 191
                  ? result.providerMessageId
                  : null
              : null,
          encoding: result.outcome === 'ACCEPTED' ? result.encoding : null,
          segmentsEstimated: result.outcome === 'ACCEPTED' ? result.segmentsEstimated : null,
          possibleDuplicate: decision.possibleDuplicate,
          sentAt: decision.attemptStatus === 'SENT' ? now : null,
          failedAt: decision.attemptStatus === 'FAILED' ? now : null,
          updatedAt: now,
          rowVersion: { increment: 1 },
        },
      });
      await tx.communication.update({
        where: { id },
        data: { status: decision.communicationStatus, updatedAt: now, rowVersion: { increment: 1 } },
      });
      await this.record(
        tx,
        tenantId,
        id,
        decision.communicationStatus,
        result.outcome === 'ACCEPTED' ? undefined : result.errorClass,
      );
      return true;
    });
    if (!committed) return;
    if (selected.id && decision.credentialAction !== 'NONE')
      await this.deps.vault.setStatus(
        tenantId,
        selected.id,
        decision.credentialAction === 'INVALID' ? 'INVALID' : 'SUSPENDED_BALANCE',
        result.outcome === 'ACCEPTED' ? null : result.errorClass,
      );
    if (decision.retry === 'BALANCE_CHECK')
      throw new RateLimitedJobError(new Date(this.clock.now().getTime() + 300000));
    if (decision.retry !== 'NONE')
      throw Object.assign(new Error('SMS_RETRY_REQUIRED'), {
        code: result.outcome === 'ACCEPTED' ? 'PROVIDER_UNAVAILABLE' : result.errorClass,
      });
    if (decision.communicationStatus === 'FAILED') throw new NonRetryableJobError('SMS_DELIVERY_FAILED');
  }
}
