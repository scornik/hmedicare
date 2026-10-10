import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, type ServerConfig } from '@hmedic/config';
import { testEnv } from '@hmedic/config/testing';
import { ProviderCredentialVault } from '@hmedic/provider-credentials';
import { SecretEnvelope, kekFromBase64 } from '@hmedic/secrets';
import { registerTransactionalSmsJobs } from '../../src/nest/transactional-sms-jobs';
import { createHmac } from 'node:crypto';
import { newId } from '@hmedic/kernel';
import { PrismaAuditPort } from '@hmedic/audit';
import { PatientCommunicationSource } from '@hmedic/patient';
import { FollowUpReminderSource } from '@hmedic/follow-up';
import { MockSmsAdapter, MockEmailAdapter } from '@hmedic/communication-adapters-mock';
import {
  RateLimiter,
  JobRegistry,
  JobRunner,
  OutboxPublisher,
  SubscriptionRegistry,
  RateLimitedJobError,
  NonRetryableJobError,
} from '@hmedic/jobs';
import {
  SmsAccountService,
  TransactionalSmsDelivery,
  platformSmsCredential,
  CommunicationService,
} from '../../src/public';
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

async function smsFixture(maxSendsPerMinute = 30) {
  const f = await fixture();
  await db.prisma.patientConsent.update({ where: { id: f.consentId }, data: { purpose: 'sms' } });
  await db.prisma.patientContact.update({
    where: { id: f.contactId },
    data: { type: 'PHONE', normalizedValue: '+8801700000099', displayValue: '+8801700000099' },
  });
  let now = clock.now();
  const smsClock = { now: () => new Date(now) };
  const advance = (ms: number) => {
    now = new Date(now.getTime() + ms);
  };
  const config = loadConfig<ServerConfig>('worker', testEnv());
  const vault = new ProviderCredentialVault(
    db.prisma,
    new SecretEnvelope({
      current: kekFromBase64(config.PROVIDER_CREDENTIAL_KEK_ID, config.PROVIDER_CREDENTIAL_KEK),
    }),
    config.PROVIDER_CREDENTIAL_FINGERPRINT_PEPPER,
    new PrismaAuditPort(smsClock),
    smsClock,
  );
  const provider = new MockSmsAdapter();
  const delivery = new TransactionalSmsDelivery(
    {
      prisma: db.prisma,
      audit: new PrismaAuditPort(smsClock),
      provider,
      platform: platformSmsCredential('synthetic-platform-key', 'HMEDIC'),
      vault,
      rateLimiter: new RateLimiter(db.prisma, config.RATE_LIMIT_PEPPER, smsClock),
      maxSendsPerMinute,
      clock: smsClock,
    },
    new PatientCommunicationSource(),
    new FollowUpReminderSource(db.prisma, smsClock),
  );
  const registry = new JobRegistry();
  registerTransactionalSmsJobs(registry, null, delivery, db.prisma, smsClock);
  service.enableTransactionalSms(delivery);
  const intent = await service.requestReminder({ ...f.input, channel: 'sms' });
  const identity = { communicationId: intent.id, credentialScope: 'PLATFORM' as const, credentialId: null };
  return { ...f, vault, provider, delivery, intent, identity, advance, registry, smsClock };
}
describe('transactional SMS worker', () => {
  it('dispatches an account-keyed identifier-only job and records acceptance without claiming delivery', async () => {
    const f = await smsFixture();
    await service.deliver(f.tenantId, f.intent.id);
    await service.deliver(f.tenantId, f.intent.id);
    const jobs = await db.prisma.job.findMany({ where: { type: 'DeliverTransactionalSms' } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.concurrencyKey).toBe('sms:PLATFORM:platform');
    expect(JSON.stringify(jobs[0]!.payload)).not.toMatch(/1700000099|synthetic-platform-key|shortLink/);
    const runner = new JobRunner(db.prisma, f.registry, {
      strategy: 'skip_locked',
      app: 'sms-test',
      clock: f.smsClock,
      concurrencyLimitFor: () => 2,
    });
    runner.handle('DeliverTransactionalSms', (ctx) =>
      f.delivery.execute(ctx.tenantId!, ctx.payload as unknown as typeof f.identity),
    );
    await runner.execute((await runner.claim('notifications', 1))[0]!);
    await f.delivery.execute(f.tenantId, f.identity);
    expect(f.provider.sent).toHaveLength(1);
    const attempt = await db.prisma.communicationAttempt.findFirstOrThrow();
    expect(attempt).toMatchObject({
      status: 'SENT',
      smsCredentialScope: 'PLATFORM',
      outcomeClass: 'ACCEPTED',
      possibleDuplicate: false,
    });
    expect((await db.prisma.communication.findUniqueOrThrow({ where: { id: f.intent.id } })).status).toBe(
      'SENT',
    );
    expect(attempt.deliveredAt).toBeNull();
  });
  it('claims at most two transactional jobs for one credential account', async () => {
    const f = await smsFixture();
    await f.delivery.enqueue(f.tenantId, f.intent.id);
    for (let index = 0; index < 2; index++) {
      const intent = await service.requestReminder({
        ...f.input,
        channel: 'sms',
        idempotencyKey: 'concurrency-' + index,
      });
      await f.delivery.enqueue(f.tenantId, intent.id);
    }
    const runner = new JobRunner(db.prisma, f.registry, {
      strategy: 'skip_locked',
      app: 'sms-concurrency',
      clock: f.smsClock,
      concurrencyLimitFor: (key) => (key.startsWith('sms:') ? 2 : 1),
    });
    const claimed = await runner.claim('notifications', 3);
    expect(claimed).toHaveLength(2);
    expect(await runner.claim('notifications', 3)).toHaveLength(0);
    expect(await db.prisma.job.count({ where: { status: 'QUEUED', type: 'DeliverTransactionalSms' } })).toBe(
      1,
    );
  });
  it.each(['consent', 'contact', 'source', 'encounter', 'tenant'] as const)(
    'rechecks %s before an SMS provider call',
    async (change) => {
      const f = await smsFixture();
      if (change === 'consent')
        await db.prisma.patientConsent.update({
          where: { id: f.consentId },
          data: { status: 'WITHDRAWN', withdrawnAt: clock.now() },
        });
      if (change === 'contact')
        await db.prisma.patientContact.update({
          where: { id: f.contactId },
          data: { verificationStatus: 'UNVERIFIED', verifiedAt: null },
        });
      if (change === 'source')
        await db.prisma.followUpPlan.update({ where: { id: f.planId }, data: { status: 'CANCELLED' } });
      if (change === 'encounter')
        await db.prisma.encounter.update({
          where: { id: f.encounterId },
          data: { status: 'ENTERED_IN_ERROR', enteredInErrorReason: 'SYNTHETIC wrong encounter' },
        });
      await f.delivery.execute(change === 'tenant' ? newId() : f.tenantId, f.identity);
      expect(f.provider.sent).toHaveLength(0);
      expect(await db.prisma.communicationAttempt.count()).toBe(0);
    },
  );
  it('resends at most once after an unknown outcome and flags the accepted retry', async () => {
    const f = await smsFixture();
    f.provider.enqueue('unknown_outcome', 'success');
    await expect(f.delivery.execute(f.tenantId, f.identity)).rejects.toMatchObject({
      code: 'UNKNOWN_OUTCOME',
    });
    await f.delivery.execute(f.tenantId, f.identity);
    await f.delivery.execute(f.tenantId, f.identity);
    const attempts = await db.prisma.communicationAttempt.findMany({ orderBy: { attemptNumber: 'asc' } });
    expect(attempts.map((a) => a.status)).toEqual(['UNKNOWN', 'SENT']);
    expect(attempts[1]!.possibleDuplicate).toBe(true);
    expect(f.provider.sent).toHaveLength(2);
  });
  it('stops after two unknown outcomes and never creates a third send', async () => {
    const f = await smsFixture();
    f.provider.defaultScenario = 'unknown_outcome';
    await expect(f.delivery.execute(f.tenantId, f.identity)).rejects.toThrow();
    await f.delivery.execute(f.tenantId, f.identity);
    await f.delivery.execute(f.tenantId, f.identity);
    expect(f.provider.sent).toHaveLength(2);
    expect(await db.prisma.communicationAttempt.count({ where: { status: 'UNKNOWN' } })).toBe(2);
  });
  it('does not turn the single unknown retry into more provider-unavailable retries', async () => {
    const f = await smsFixture();
    f.provider.enqueue('unknown_outcome', 'provider_unavailable');
    await expect(f.delivery.execute(f.tenantId, f.identity)).rejects.toThrow();
    await expect(f.delivery.execute(f.tenantId, f.identity)).rejects.toBeInstanceOf(NonRetryableJobError);
    await f.delivery.execute(f.tenantId, f.identity);
    expect(f.provider.sent).toHaveLength(2);
    expect((await db.prisma.communication.findUniqueOrThrow({ where: { id: f.intent.id } })).status).toBe(
      'FAILED',
    );
  });
  it('bounds unavailable sends to five attempts', async () => {
    const f = await smsFixture();
    f.provider.defaultScenario = 'provider_unavailable';
    for (let i = 0; i < 4; i++) await expect(f.delivery.execute(f.tenantId, f.identity)).rejects.toThrow();
    await expect(f.delivery.execute(f.tenantId, f.identity)).rejects.toBeInstanceOf(NonRetryableJobError);
    await f.delivery.execute(f.tenantId, f.identity);
    expect(f.provider.sent).toHaveLength(5);
  });
  it('revalidates SMS consent and preferences after queueing', async () => {
    const f = await smsFixture();
    await service.setPreference(f.tenantId, f.patientId, 'sms', 'OPT_OUT', 1);
    await f.delivery.execute(f.tenantId, f.identity);
    expect(f.provider.sent).toHaveLength(0);
    expect(await db.prisma.communicationAttempt.count()).toBe(0);
    expect((await db.prisma.communication.findUniqueOrThrow({ where: { id: f.intent.id } })).status).toBe(
      'CANCELLED',
    );
  });
  it('never uses the platform for a pending tenant credential or after pinned selection changes', async () => {
    const f = await smsFixture();
    const account = await f.vault.create({
      tenantId: f.tenantId,
      actorUserId: null,
      providerKind: 'SMS',
      providerCode: 'zamanit',
      environment: 'na',
      publicIdentifier: 'DEMO',
      bundle: { apiKey: 'synthetic-tenant-key' },
      last4Field: 'apiKey',
    });
    await expect(f.delivery.execute(f.tenantId, f.identity)).rejects.toBeInstanceOf(NonRetryableJobError);
    expect(f.provider.sent).toHaveLength(0);
    const other = await service.requestReminder({
      ...f.input,
      channel: 'sms',
      idempotencyKey: 'new-account',
    });
    await expect(
      f.delivery.execute(f.tenantId, {
        communicationId: other.id,
        credentialScope: 'TENANT',
        credentialId: account.id,
      }),
    ).rejects.toBeInstanceOf(NonRetryableJobError);
    expect(f.provider.sent).toHaveLength(0);
  });
  it('suspends an empty tenant account, waits without resends and expires after 24 hours', async () => {
    const f = await smsFixture();
    const account = await f.vault.create({
      tenantId: f.tenantId,
      actorUserId: null,
      providerKind: 'SMS',
      providerCode: 'zamanit',
      environment: 'na',
      publicIdentifier: 'DEMO',
      bundle: { apiKey: 'synthetic-tenant-key' },
      last4Field: 'apiKey',
    });
    await f.vault.setStatus(f.tenantId, account.id, 'ACTIVE', null);
    const identity = { ...f.identity, credentialScope: 'TENANT' as const, credentialId: account.id };
    f.provider.enqueue('e1006');
    await expect(f.delivery.execute(f.tenantId, identity)).rejects.toBeInstanceOf(RateLimitedJobError);
    expect((await f.vault.list(f.tenantId, 'SMS'))[0]!.status).toBe('SUSPENDED_BALANCE');
    await expect(f.delivery.execute(f.tenantId, identity)).rejects.toBeInstanceOf(RateLimitedJobError);
    expect(f.provider.sent).toHaveLength(1);
    f.advance(86400000);
    await expect(f.delivery.execute(f.tenantId, identity)).rejects.toBeInstanceOf(NonRetryableJobError);
    expect(f.provider.sent).toHaveLength(1);
  });
  it('checks platform balance before retrying and never resends while balance is unresolved', async () => {
    const f = await smsFixture();
    f.provider.enqueue('e1006');
    await expect(f.delivery.execute(f.tenantId, f.identity)).rejects.toBeInstanceOf(RateLimitedJobError);
    f.provider.enqueue('unparsed_balance');
    await expect(f.delivery.execute(f.tenantId, f.identity)).rejects.toBeInstanceOf(RateLimitedJobError);
    expect(f.provider.sent).toHaveLength(1);
    expect(await db.prisma.communicationAttempt.count()).toBe(1);
    await f.delivery.execute(f.tenantId, f.identity);
    expect(f.provider.sent).toHaveLength(2);
  });
  it('uses a tenant handle only for its own account and marks credential rejection invalid', async () => {
    const f = await smsFixture();
    const account = await f.vault.create({
      tenantId: f.tenantId,
      actorUserId: null,
      providerKind: 'SMS',
      providerCode: 'zamanit',
      environment: 'na',
      publicIdentifier: 'DEMO',
      bundle: { apiKey: 'synthetic-tenant-key' },
      last4Field: 'apiKey',
    });
    await f.vault.setStatus(f.tenantId, account.id, 'ACTIVE', null);
    const original = f.provider.send.bind(f.provider);
    f.provider.send = async (input) => {
      expect(input.credential.scope).toBe('TENANT');
      expect(input.credential.tenantId).toBe(f.tenantId);
      expect(input.credential.senderId).toBe('DEMO');
      await input.credential.withKey(async (key) => {
        expect(key).toBe('synthetic-tenant-key');
      });
      return original(input);
    };
    f.provider.enqueue('e1001');
    await expect(
      f.delivery.execute(f.tenantId, { ...f.identity, credentialScope: 'TENANT', credentialId: account.id }),
    ).rejects.toBeInstanceOf(NonRetryableJobError);
    expect((await f.vault.list(f.tenantId, 'SMS'))[0]!.status).toBe('INVALID');
    expect(f.provider.sent).toHaveLength(1);
    expect((await db.prisma.communicationAttempt.findFirstOrThrow()).smsCredentialId).toBe(account.id);
  });
  it('waits at the account rate limit without recording a second send attempt', async () => {
    const f = await smsFixture(1);
    f.provider.enqueue('provider_unavailable');
    await expect(f.delivery.execute(f.tenantId, f.identity)).rejects.toThrow();
    await expect(f.delivery.execute(f.tenantId, f.identity)).rejects.toBeInstanceOf(RateLimitedJobError);
    expect(f.provider.sent).toHaveLength(1);
    expect(await db.prisma.communicationAttempt.count()).toBe(1);
  });
  it('does not immediately resend a crashed sending attempt, then permits one flagged recovery', async () => {
    const f = await smsFixture();
    const controller = new AbortController();
    const send = f.provider.send.bind(f.provider);
    f.provider.send = async (input) => {
      const result = await send(input);
      controller.abort();
      return result;
    };
    await f.delivery.execute(f.tenantId, f.identity, controller.signal);
    await expect(f.delivery.execute(f.tenantId, f.identity)).rejects.toBeInstanceOf(RateLimitedJobError);
    expect(f.provider.sent).toHaveLength(1);
    f.advance(240000);
    f.provider.send = send;
    await f.delivery.execute(f.tenantId, f.identity);
    expect(f.provider.sent).toHaveLength(2);
    expect(
      (await db.prisma.communicationAttempt.findFirstOrThrow({ where: { attemptNumber: 2 } }))
        .possibleDuplicate,
    ).toBe(true);
  });
});

describe('tenant SMS account management', () => {
  const key = 'synthetic-sms-account-key-1234';
  async function setup() {
    const f = await smsFixture();
    const accounts = new SmsAccountService(
      db.prisma,
      f.vault,
      f.provider,
      new PrismaAuditPort(f.smsClock),
      '100',
      f.smsClock,
    );
    const credential = await accounts.create(f.tenantId, f.userId, { apiKey: key, senderId: 'DEMO' });
    return { ...f, accounts, credential };
  }
  it('returns only masked metadata and validates with a free balance call', async () => {
    const f = await setup();
    expect(JSON.stringify(await f.accounts.list(f.tenantId, f.userId))).not.toContain(key);
    const result = await f.accounts.validate(f.tenantId, f.userId, f.credential.id, f.credential.rowVersion);
    expect(result.credential.status).toBe('ACTIVE');
    expect(result.balance?.parseStatus).toBe('PARSED');
    expect(f.provider.sent).toHaveLength(0);
    expect(result.credential.senderIdStatus).toBe('UNVERIFIED');
    expect(await db.prisma.smsBalanceSnapshot.count()).toBe(1);
    expect(JSON.stringify(result)).not.toMatch(
      /encryptedSecret|wrappedDataKey|secretFingerprint|synthetic-sms-account/,
    );
  });
  it('does not mark an unparsed balance as validated', async () => {
    const f = await setup();
    f.provider.enqueue('unparsed_balance');
    const result = await f.accounts.validate(f.tenantId, f.userId, f.credential.id, f.credential.rowVersion);
    expect(result.credential.status).toBe('PENDING_VALIDATION');
    expect(result.balance).toMatchObject({ balance: null, parseStatus: 'UNPARSED' });
    expect(result.credential.validatedAt).toBeNull();
  });
  it('rejects stale validation before a provider call and discards revoked in-flight results atomically', async () => {
    const f = await setup();
    await expect(f.accounts.validate(f.tenantId, f.userId, f.credential.id, 999)).rejects.toMatchObject({
      code: 'STALE_VERSION',
    });
    const original = f.provider.checkBalance.bind(f.provider);
    f.provider.checkBalance = async () => {
      await f.accounts.revoke(f.tenantId, f.userId, f.credential.id);
      return original();
    };
    await expect(
      f.accounts.validate(f.tenantId, f.userId, f.credential.id, f.credential.rowVersion),
    ).rejects.toMatchObject({ code: 'STALE_VERSION' });
    expect((await f.vault.getView(f.tenantId, f.credential.id, 'SMS')).status).toBe('REVOKED');
    expect(await db.prisma.smsBalanceSnapshot.count()).toBe(0);
  });
  it('isolates account balances and validation by tenant and makes repeated revocation harmless', async () => {
    const f = await setup();
    for (const action of [
      () => f.accounts.balance(newId(), f.userId, f.credential.id),
      () => f.accounts.validate(newId(), f.userId, f.credential.id, f.credential.rowVersion),
      () => f.accounts.revoke(newId(), f.userId, f.credential.id),
    ])
      await expect(action()).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await f.accounts.revoke(f.tenantId, f.userId, f.credential.id);
    await expect(f.accounts.revoke(f.tenantId, f.userId, f.credential.id)).resolves.toMatchObject({
      status: 'REVOKED',
    });
    expect(
      (await db.prisma.providerCredential.findUniqueOrThrow({ where: { id: f.credential.id } }))
        .encryptedSecret,
    ).toBe('revoked');
  });
  it('reports observed spend as an estimate without counting account top-ups', async () => {
    const f = await setup();
    for (const [index, balance] of ['100.00', '90.00', '150.00', '130.00'].entries())
      await db.prisma.smsBalanceSnapshot.create({
        data: {
          id: newId(),
          tenantId: null,
          credentialScope: 'PLATFORM',
          credentialId: null,
          providerCode: 'mock',
          balance,
          parseStatus: 'PARSED',
          checkedAt: new Date(clock.now().getTime() + index * 60000),
        },
      });
    const result = await f.accounts.platformBalance(f.userId);
    expect(result.latest?.balance).toBe('130.00');
    expect(result.dailySpendEstimate).toEqual([{ day: '2026-10-10', estimateBdt: '30.00' }]);
    expect(result.truncated).toBe(false);
  });
});
