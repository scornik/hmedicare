import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { newId } from '@hmedic/kernel';
import { PrismaAuditPort } from '@hmedic/audit';
import { PatientCommunicationSource } from '@hmedic/patient';
import { FollowUpReminderSource } from '@hmedic/follow-up';
import { MockEmailAdapter } from '@hmedic/communication-adapters-mock';
import {
  JobRegistry,
  JobRunner,
  OutboxPublisher,
  SubscriptionRegistry,
  RateLimitedJobError,
  NonRetryableJobError,
} from '@hmedic/jobs';
import { CommunicationService } from '../../src/public';
import { createDueReminders } from '../../src/nest/reminder-jobs';
import { registerDeliveryJobs } from '../../src/nest/delivery-jobs';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';
import { chamberWithCalledSerial } from '../../../../tests/support/clinical';

const db = openTestDatabase({ poolMax: 12 });
const clock = { now: () => new Date('2026-10-10T04:00:00Z') };
const secret = 'synthetic-notification-webhook-secret';
let adapter: MockEmailAdapter, service: CommunicationService;
afterAll(() => db.close());
beforeEach(async () => {
  await truncateAll();
  adapter = new MockEmailAdapter(secret);
  service = new CommunicationService(
    db.prisma,
    new PrismaAuditPort(clock),
    new PatientCommunicationSource(),
    new FollowUpReminderSource(db.prisma, clock),
    new Map([['email', adapter]]),
    clock,
  );
});
async function fixture() {
  const f = await chamberWithCalledSerial(db.prisma, 'communication');
  const now = clock.now(),
    encounterId = newId(),
    planId = newId(),
    consentId = newId(),
    contactId = newId();
  await db.prisma.encounter.create({
    data: {
      id: encounterId,
      tenantId: f.tenantId,
      patientId: f.patientId,
      doctorProfileId: f.doctorProfileId,
      chamberId: f.chamberId,
      serialId: f.serial.id,
      status: 'IN_PROGRESS',
      careMode: 'PHYSICAL',
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.prisma.followUpPlan.create({
    data: {
      id: planId,
      tenantId: f.tenantId,
      patientId: f.patientId,
      sourceEncounterId: encounterId,
      doctorProfileId: f.doctorProfileId,
      dueStartDate: new Date('2026-10-10'),
      reason: 'SYNTHETIC clinical reason must stay private',
      status: 'PLANNED',
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.prisma.patientConsent.create({
    data: {
      id: consentId,
      tenantId: f.tenantId,
      patientId: f.patientId,
      purpose: 'email',
      status: 'GRANTED',
      policyVersion: 1,
      givenByRelationship: 'SELF',
      capturedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.prisma.patientContact.create({
    data: {
      id: contactId,
      tenantId: f.tenantId,
      patientId: f.patientId,
      type: 'EMAIL',
      normalizedValue: 'synthetic@example.invalid',
      displayValue: 'synthetic@example.invalid',
      normalizedValueHash: 'a'.repeat(64),
      verificationStatus: 'VERIFIED',
      verifiedAt: now,
      status: 'ACTIVE',
      relationship: 'SELF',
      createdAt: now,
      updatedAt: now,
    },
  });
  return {
    ...f,
    encounterId,
    planId,
    consentId,
    contactId,
    input: {
      tenantId: f.tenantId,
      patientId: f.patientId,
      planId,
      channel: 'email' as const,
      locale: 'en-BD' as const,
      idempotencyKey: 'reminder-1',
    },
  };
}
describe('communication intents and delivery', () => {
  it('fails a queued intent when its provider is removed, without inventing an attempt', async () => {
    const f = await fixture();
    const intent = await service.requestReminder(f.input);
    const disabled = new CommunicationService(
      db.prisma,
      new PrismaAuditPort(clock),
      new PatientCommunicationSource(),
      new FollowUpReminderSource(db.prisma, clock),
      new Map(),
      clock,
    );
    await expect(disabled.deliver(f.tenantId, intent.id)).rejects.toBeInstanceOf(NonRetryableJobError);
    expect((await db.prisma.communication.findUniqueOrThrow({ where: { id: intent.id } })).status).toBe(
      'FAILED',
    );
    expect(await db.prisma.communicationAttempt.count()).toBe(0);
    expect(
      await db.prisma.outboxEvent.count({
        where: { eventName: 'CommunicationFailed', aggregateId: intent.id },
      }),
    ).toBe(1);
    await disabled.deliver(f.tenantId, intent.id);
    expect(
      await db.prisma.outboxEvent.count({
        where: { eventName: 'CommunicationFailed', aggregateId: intent.id },
      }),
    ).toBe(1);
  });

  it('keeps an unresolved sending attempt UNKNOWN when its provider is removed', async () => {
    const f = await fixture();
    const intent = await service.requestReminder(f.input);
    adapter.send = async () => {
      throw Error('synthetic lost response');
    };
    await expect(service.deliver(f.tenantId, intent.id)).rejects.toThrow();
    const disabled = new CommunicationService(
      db.prisma,
      new PrismaAuditPort(clock),
      new PatientCommunicationSource(),
      new FollowUpReminderSource(db.prisma, clock),
      new Map(),
      clock,
    );
    await expect(disabled.deliver(f.tenantId, intent.id)).rejects.toBeInstanceOf(NonRetryableJobError);
    const attempt = await db.prisma.communicationAttempt.findFirstOrThrow({
      where: { communicationId: intent.id },
    });
    expect(attempt.status).toBe('UNKNOWN');
    expect(attempt.errorClass).toBe('UNKNOWN_OUTCOME');
    expect((await db.prisma.communication.findUniqueOrThrow({ where: { id: intent.id } })).status).toBe(
      'FAILED',
    );
  });

  it('scans due tasks once, enqueues a reminder and consumes the task with a version check', async () => {
    const f = await fixture();
    const task = await db.prisma.followUpTask.create({
      data: {
        id: newId(),
        tenantId: f.tenantId,
        followUpPlanId: f.planId,
        taskType: 'REMINDER',
        status: 'OPEN',
        dueAt: new Date('2026-10-09T18:00:00Z'),
        createdAt: clock.now(),
        updatedAt: clock.now(),
      },
    });
    const source = new FollowUpReminderSource(db.prisma, clock);
    await createDueReminders(service, source);
    await createDueReminders(service, source);
    expect(await db.prisma.communication.count()).toBe(1);
    expect((await db.prisma.followUpTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('DONE');
    expect(await db.prisma.communicationAttempt.count()).toBe(0);
  });
  it('does not create an early reminder or treat OPT_IN as consent', async () => {
    const f = await fixture();
    await db.prisma.followUpPlan.update({
      where: { id: f.planId },
      data: { dueStartDate: new Date('2026-10-11') },
    });
    expect((await service.requestReminder(f.input)).status).toBe('CANCELLED');
    await db.prisma.followUpPlan.update({
      where: { id: f.planId },
      data: { dueStartDate: new Date('2026-10-10') },
    });
    await db.prisma.patientConsent.update({
      where: { id: f.consentId },
      data: { status: 'WITHDRAWN', withdrawnAt: clock.now() },
    });
    await service.setPreference(f.tenantId, f.patientId, 'email', 'OPT_IN', 1);
    expect((await service.requestReminder({ ...f.input, idempotencyKey: 'new' })).status).toBe('CANCELLED');
  });
  it('reuses an in-flight attempt across overlapping execution and records acceptance once', async () => {
    const f = await fixture(),
      c = await service.requestReminder(f.input);
    let release!: () => void,
      start!: () => void,
      calls = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      start = resolve;
    });
    const send = adapter.send.bind(adapter);
    adapter.send = async (input) => {
      if (++calls === 1) {
        start();
        await gate;
      }
      return send(input);
    };
    const first = service.deliver(f.tenantId, c.id);
    await started;
    await service.deliver(f.tenantId, c.id);
    release();
    await first;
    expect(await db.prisma.communicationAttempt.count()).toBe(1);
    expect(await db.prisma.outboxEvent.count({ where: { eventName: 'CommunicationSent' } })).toBe(1);
  });
  it('ends an unreconciled provider exception with UNKNOWN rather than claiming acceptance', async () => {
    const f = await fixture(),
      c = await service.requestReminder(f.input);
    adapter.send = async () => {
      throw new Error('SYNTHETIC provider response with private data');
    };
    await expect(service.deliver(f.tenantId, c.id, undefined, 5)).rejects.toBeInstanceOf(
      NonRetryableJobError,
    );
    const a = await db.prisma.communicationAttempt.findFirstOrThrow({ where: { communicationId: c.id } });
    expect(a.status).toBe('UNKNOWN');
    expect(a.errorClass).toBe('UNKNOWN_OUTCOME');
    expect((await db.prisma.communication.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('FAILED');
    expect(JSON.stringify(a)).not.toContain('private data');
  });
  it('replays an early receipt without mutating the append-only ledger', async () => {
    const f = await fixture(),
      c = await service.requestReminder(f.input);
    const send = adapter.send.bind(adapter);
    let input!: { rawBody: Buffer; headers: Record<string, string> };
    adapter.send = async (value) => {
      const result = await send(value);
      if (result.outcome === 'ACCEPTED') {
        const rawBody = Buffer.from(
          JSON.stringify({ eventId: 'early', messageId: result.providerMessageId, status: 'failed' }),
        );
        input = {
          rawBody,
          headers: { 'x-mock-signature': createHmac('sha256', secret).update(rawBody).digest('hex') },
        };
        await service.receiveWebhook(adapter, input);
      }
      return result;
    };
    await service.deliver(f.tenantId, c.id);
    const first = await db.prisma.providerWebhookEvent.findFirstOrThrow();
    expect(first.mappedAttemptId).toBeNull();
    await service.receiveWebhook(adapter, input);
    await service.receiveWebhook(adapter, input);
    expect((await db.prisma.communication.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('FAILED');
    expect(await db.prisma.providerWebhookEvent.findFirstOrThrow()).toEqual(first);
    expect(await db.prisma.outboxEvent.count({ where: { eventName: 'CommunicationReceiptRecorded' } })).toBe(
      1,
    );
  });
  it('creates one intent/outbox event under concurrent requests and rejects changed replay input', async () => {
    const f = await fixture();
    const results = await Promise.all([service.requestReminder(f.input), service.requestReminder(f.input)]);
    expect(results[0].id).toBe(results[1].id);
    expect(await db.prisma.communication.count()).toBe(1);
    expect(
      await db.prisma.outboxEvent.count({ where: { eventName: 'CommunicationDeliveryRequested' } }),
    ).toBe(1);
    await expect(service.requestReminder({ ...f.input, locale: 'bn-BD' })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
    const events = await db.prisma.outboxEvent.findMany({ select: { payload: true } });
    const audit = await db.prisma.auditLog.findMany({ select: { metadata: true } });
    expect(JSON.stringify([events, audit])).not.toContain('synthetic@example');
    expect(JSON.stringify([events, audit])).not.toContain('SYNTHETIC clinical');
  });
  it('delivers outside the transaction and replays acceptance after a lost response with one attempt', async () => {
    const f = await fixture(),
      c = await service.requestReminder(f.input);
    const send = adapter.send.bind(adapter);
    let calls = 0;
    adapter.send = async (input) => {
      // A second connection can acquire the communication row while the provider call runs.
      await db.prisma.communication.update({ where: { id: c.id }, data: { updatedAt: clock.now() } });
      const result = await send(input);
      if (++calls === 1) throw new Error('synthetic lost response');
      return result;
    };
    await expect(service.deliver(f.tenantId, c.id)).rejects.toThrow('COMMUNICATION_PROVIDER_OUTCOME_UNKNOWN');
    await service.deliver(f.tenantId, c.id);
    await service.deliver(f.tenantId, c.id);
    expect(calls).toBe(2);
    expect(await db.prisma.communicationAttempt.count()).toBe(1);
    expect((await db.prisma.communication.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('SENT');
  });
  it.each(['consent', 'preference', 'contact', 'source', 'encounter'])(
    'suppresses delivery when %s changes after enqueue',
    async (change) => {
      const f = await fixture(),
        c = await service.requestReminder(f.input);
      if (change === 'consent')
        await db.prisma.patientConsent.update({
          where: { id: f.consentId },
          data: { status: 'WITHDRAWN', withdrawnAt: clock.now() },
        });
      if (change === 'preference')
        await service.setPreference(f.tenantId, f.patientId, 'email', 'OPT_OUT', 1);
      if (change === 'contact')
        await db.prisma.patientContact.update({
          where: { id: f.contactId },
          data: { verificationStatus: 'UNVERIFIED' },
        });
      if (change === 'source')
        await db.prisma.followUpPlan.update({ where: { id: f.planId }, data: { status: 'CANCELLED' } });
      if (change === 'encounter')
        await db.prisma.encounter.update({
          where: { id: f.encounterId },
          data: { status: 'ENTERED_IN_ERROR', enteredInErrorReason: 'SYNTHETIC wrong encounter' },
        });
      await service.deliver(f.tenantId, c.id);
      expect((await db.prisma.communication.findUniqueOrThrow({ where: { id: c.id } })).status).toBe(
        'CANCELLED',
      );
      expect(await db.prisma.communicationAttempt.count()).toBe(0);
    },
  );
  it('retries transient failure, honors rate limiting and terminates on permanent rejection', async () => {
    const f = await fixture(),
      c = await service.requestReminder(f.input);
    adapter.enqueue('transient_failure', 'rate_limit', 'permanent_failure');
    await expect(service.deliver(f.tenantId, c.id)).rejects.toThrow('COMMUNICATION_PROVIDER_UNAVAILABLE');
    await expect(service.deliver(f.tenantId, c.id)).rejects.toBeInstanceOf(RateLimitedJobError);
    await expect(service.deliver(f.tenantId, c.id)).rejects.toBeInstanceOf(NonRetryableJobError);
    expect(await db.prisma.communicationAttempt.count()).toBe(3);
    expect((await db.prisma.communication.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('FAILED');
  });
  it('stops after five transient failures', async () => {
    const f = await fixture(),
      c = await service.requestReminder(f.input);
    adapter.enqueue(...Array.from({ length: 5 }, () => 'transient_failure' as const));
    for (let i = 0; i < 4; i++) await expect(service.deliver(f.tenantId, c.id)).rejects.toThrow();
    await expect(service.deliver(f.tenantId, c.id)).rejects.toBeInstanceOf(NonRetryableJobError);
    expect((await db.prisma.communication.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('FAILED');
  });
  it('deduplicates concurrent signed receipts and prevents late status regression', async () => {
    const f = await fixture(),
      c = await service.requestReminder(f.input);
    await service.deliver(f.tenantId, c.id);
    const a = await db.prisma.communicationAttempt.findFirstOrThrow({ where: { communicationId: c.id } });
    const receipt = (eventId: string, status: string) => {
      const rawBody = Buffer.from(JSON.stringify({ eventId, messageId: a.providerMessageId, status }));
      return {
        rawBody,
        headers: { 'x-mock-signature': createHmac('sha256', secret).update(rawBody).digest('hex') },
      };
    };
    const r = receipt('event-read', 'read');
    await Promise.all([service.receiveWebhook(adapter, r), service.receiveWebhook(adapter, r)]);
    await service.receiveWebhook(adapter, receipt('event-delivered', 'delivered'));
    expect((await db.prisma.communication.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('READ');
    expect(await db.prisma.providerWebhookEvent.count()).toBe(2);
    expect(await db.prisma.outboxEvent.count({ where: { eventName: 'CommunicationReceiptRecorded' } })).toBe(
      1,
    );
    expect(await service.receiveWebhook(adapter, { ...r, headers: {} })).toBeNull();
  });
  it('publishes an identifier-only notification job and runs it through the existing runner', async () => {
    const f = await fixture(),
      c = await service.requestReminder(f.input);
    const registry = new JobRegistry(),
      subscriptions = new SubscriptionRegistry();
    const runner = new JobRunner(db.prisma, registry, { strategy: 'skip_locked', app: 'test', clock });
    registerDeliveryJobs(registry, runner, subscriptions, service);
    await new OutboxPublisher(db.prisma, registry, subscriptions, {
      strategy: 'skip_locked',
      clock,
    }).publishBatch();
    const jobs = await runner.claim('notifications', 1);
    expect(jobs).toHaveLength(1);
    expect(JSON.stringify(jobs[0]!.payload)).not.toContain('synthetic@example');
    expect(jobs[0]!.concurrencyKey).toContain(c.id);
    await runner.execute(jobs[0]!);
    expect((await db.prisma.communication.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('SENT');
  });
  it('rejects cross-tenant source and contact references', async () => {
    const f = await fixture(),
      other = await chamberWithCalledSerial(db.prisma, 'communication-other');
    const c = await service.requestReminder({
      ...f.input,
      tenantId: other.tenantId,
      patientId: other.patientId,
    });
    expect(c.status).toBe('CANCELLED');
    await expect(
      service.setPreference(other.tenantId, other.patientId, 'email', 'OPT_IN', 1, f.contactId),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await service.deliver(other.tenantId, c.id);
    expect(await db.prisma.communicationAttempt.count()).toBe(0);
  });
});
