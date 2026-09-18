import { type ChildProcess, spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type ServerConfig, loadConfig } from '@hmedic/config';
import { testEnv } from '@hmedic/config/testing';
import { newId } from '@hmedic/kernel';
import { OutboxPort } from '@hmedic/jobs';
import { createLogger } from '@hmedic/observability';
import { SmsOtpDelivery, platformSmsCredential, runSmsBalanceCheck } from '@hmedic/communication';
import { ZamanItSmsAdapter } from '@hmedic/communication-adapters-zamanit';
import { GateDecisionReader, GateDecisionRecorder } from '@hmedic/secrets';
import { createProviderCredentialVault } from '@hmedic/provider-credentials/worker';
import { type ApiInstance, buildApi } from '../../src/compose';
import { testDatabaseUrl, truncateAll } from '../../../../tests/support/db';

// SMS-005 (OTP over Zaman IT against mock-providers, T30), T28 production gate, CheckSmsBalance.
const KEY = 'zit_fake_0123456789abcdef0123456789abcdef';
const SERVER = path.resolve(__dirname, '../../../../infrastructure/docker/mock-providers/server.mjs');
const logLines: string[] = [];
let child: ChildProcess;
let base = '';
let api: ApiInstance;
let server: Parameters<typeof request>[0];
let seq = 0;
const idem = () => `sms-key-${Date.now()}-${++seq}`;

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}
const mock = (p: string, body?: unknown) =>
  fetch(`${base}${p}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).then((r) => r.json() as Promise<Record<string, unknown>>);
const requests = async () =>
  (await mock('/__mock/zamanit/requests')).requests as Array<Record<string, unknown>>;

beforeAll(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  for (
    let i = 0;
    i < 50 &&
    !(await fetch(`${base}/health`)
      .then((r) => r.ok)
      .catch(() => false));
    i++
  ) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const config = loadConfig<ServerConfig>(
    'api',
    testEnv({
      DATABASE_URL: testDatabaseUrl(),
      SMS_PROVIDER: 'zamanit',
      OTP_PROVIDER: 'sms',
      ZAMANIT_BASE_URL: `${base}/zamanit/api`,
      ZAMANIT_API_KEY: KEY,
      ZAMANIT_SENDER_ID: 'DEMO',
      ZAMANIT_API_KEY_ISSUED_ON: '2026-09-01',
      ZAMANIT_ALLOW_INSECURE_HTTP: 'true',
      ZAMANIT_TIMEOUT_MS: '1000',
      LOG_LEVEL: 'debug',
    }),
  );
  api = await buildApi(config);
  api.runtime.logger = createLogger({
    app: 'api',
    env: 'test',
    version: 'test',
    bootId: api.runtime.bootId,
    level: 'debug',
    destination: { write: (l: string) => void logLines.push(l) },
  });
  server = api.app.getHttpServer();
});
afterAll(async () => {
  await api?.close();
  child?.kill();
});
beforeEach(async () => {
  await truncateAll();
  await mock('/__mock/reset', {});
});

const requestOtp = (phone: string) =>
  request(server).post('/api/v1/auth/otp/request').set('idempotency-key', idem()).send({ phone }).expect(202);

describe('OTP over Zaman IT (mock-providers)', () => {
  it('sends one POST with the platform key in the body; unicode for bn-BD; no key or code in logs/DB', async () => {
    logLines.length = 0;
    const r = await requestOtp('01700000081');
    expect(r.body.data.hint).toBe('SENT');
    const [req] = await requests();
    expect(req).toMatchObject({
      method: 'POST',
      endpoint: 'sendsms',
      type: 'unicode',
      apiKeyPresent: true,
      queryPresent: false,
      senderid: 'DEMO',
    });
    expect(logLines.join('\n')).not.toContain(KEY);
    const rows = JSON.stringify(await api.runtime.prisma.otpChallenge.findMany());
    expect(rows).not.toContain('8801700000081');
    expect(api.identity.mockOtp).toBeNull(); // no dev inbox when OTP goes over SMS
    const metrics = await request(server)
      .get('/internal/metrics')
      .set('authorization', `Bearer ${api.runtime.config.INTERNAL_METRICS_TOKEN}`);
    expect(metrics.text).toMatch(/sms_send_total\{[^}]*outcome="ACCEPTED"/);
  });

  it('insufficient balance → RETRY_LATER and the challenge cannot be used', async () => {
    await mock('/__mock/zamanit/scenario', { scenario: 'e1006' });
    const r = await requestOtp('01700000082');
    expect(r.body.data.hint).toBe('RETRY_LATER');
    expect(
      (await api.runtime.prisma.otpChallenge.findUniqueOrThrow({ where: { id: r.body.data.challengeId } }))
        .status,
    ).toBe('EXPIRED');
    const metrics = await request(server)
      .get('/internal/metrics')
      .set('authorization', `Bearer ${api.runtime.config.INTERNAL_METRICS_TOKEN}`);
    expect(metrics.text).toMatch(/sms_send_total\{[^}]*error_class="INSUFFICIENT_BALANCE"/);
  });

  it('timeout after send → MAY_ARRIVE, challenge stays PENDING, never an automatic resend (T30)', async () => {
    await mock('/__mock/zamanit/scenario', { scenario: 'timeout_after_send' });
    const r = await requestOtp('01700000083');
    expect(r.body.data.hint).toBe('MAY_ARRIVE');
    expect(
      (await api.runtime.prisma.otpChallenge.findUniqueOrThrow({ where: { id: r.body.data.challengeId } }))
        .status,
    ).toBe('PENDING');
    await new Promise((res) => setTimeout(res, 500));
    expect(await requests()).toHaveLength(1);
  });
});

describe('GATE-SMS-HTTP in production (T28)', () => {
  it('refuses plain HTTP until an unexpired owner decision exists; refusals are audited', async () => {
    const reader = new GateDecisionReader(api.runtime.prisma, api.runtime.clock, 0);
    const adapter = new ZamanItSmsAdapter({
      baseUrl: `${base}/zamanit/api`,
      timeoutMs: 1000,
      allowInsecureHttp: true,
      appEnv: 'production',
      isHttpGateClosed: () => reader.isClosed('GATE-SMS-HTTP', 'production'),
    });
    const delivery = new SmsOtpDelivery(adapter, platformSmsCredential(KEY, 'DEMO'), {
      appName: 'HMedic',
      prisma: api.runtime.prisma,
      audit: api.runtime.audit,
      logger: api.runtime.logger,
      metrics: api.runtime.metrics,
    });
    const msg = {
      challengeId: newId(),
      phoneE164: '+8801700000084',
      code: '123456',
      purpose: 'LOGIN' as const,
      locale: 'en-BD' as const,
      ttlSeconds: 180,
    };
    expect(await delivery.send(msg)).toEqual({ outcome: 'REJECTED', errorClass: 'TRANSPORT_REFUSED' });
    expect(await api.runtime.prisma.auditLog.count({ where: { action: 'SMS_HTTP_GATE_REFUSED' } })).toBe(1);
    expect(await requests()).toHaveLength(0);
    await new GateDecisionRecorder(api.runtime.prisma).record({
      gateCode: 'GATE-SMS-HTTP',
      environment: 'production',
      decision: 'ACCEPTED',
      ownerName: 'Demo Owner',
      evidenceRef: 'DOC-DEMO-4',
      decidedBy: 'cli:test',
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    expect(await delivery.send({ ...msg, challengeId: newId() })).toEqual({ outcome: 'ACCEPTED' });
  });
});

describe('CheckSmsBalance', () => {
  it('snapshots the platform balance, emits SmsBalanceLow without an amount, and manages tenant credentials', async () => {
    const c = api.runtime.config;
    const vault = createProviderCredentialVault(c, api.runtime.prisma, api.runtime.audit, api.runtime.clock);
    const tenantId = newId();
    const now = new Date();
    await api.runtime.prisma.tenant.create({
      data: {
        id: tenantId,
        name: 'DEMO',
        slug: `demo-${tenantId.slice(-8)}`,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
    });
    const cred = await vault.create({
      tenantId,
      actorUserId: null,
      providerKind: 'SMS',
      providerCode: 'zamanit',
      environment: 'na',
      publicIdentifier: 'CLINIC',
      bundle: { apiKey: 'zit_fake_tenant000000000000000000000000' },
      last4Field: 'apiKey',
      balanceAlertBdt: '100.00',
    });
    await vault.setStatus(tenantId, cred.id, 'SUSPENDED_BALANCE', 'INSUFFICIENT_BALANCE');
    const adapter = new ZamanItSmsAdapter({
      baseUrl: `${base}/zamanit/api`,
      timeoutMs: 1000,
      allowInsecureHttp: true,
      appEnv: 'test',
      isHttpGateClosed: async () => false,
    });
    await mock('/__mock/zamanit/scenario', { scenario: 'low_balance' }); // platform check first
    const result = await runSmsBalanceCheck({
      prisma: api.runtime.prisma,
      provider: adapter,
      platform: platformSmsCredential(KEY, 'DEMO'),
      tenants: {
        list: async () =>
          (await vault.listSmsForBalanceCheck()).map((x) => ({
            handle: {
              scope: 'TENANT' as const,
              credentialId: x.handle.credentialId,
              tenantId: x.handle.tenantId,
              senderId: 'CLINIC',
              withKey: (fn) => x.handle.use((b) => fn(b.apiKey!)),
            },
            status: x.status,
            balanceAlertBdt: x.balanceAlertBdt,
          })),
        setStatus: (t, id, s, e) => vault.setStatus(t, id, s, e),
      },
      outbox: new OutboxPort(),
      platformAlertBdt: '500.00',
      keyIssuedOn: '2026-01-01',
      keyMaxAgeDays: 90,
      logger: api.runtime.logger,
      metrics: api.runtime.metrics,
    });
    expect(result).toEqual({ checked: 2, low: 1 });
    const snaps = await api.runtime.prisma.smsBalanceSnapshot.findMany({ orderBy: { checkedAt: 'asc' } });
    expect(snaps.map((s) => [s.credentialScope, s.balance?.toFixed(2), s.parseStatus])).toEqual([
      ['PLATFORM', '12.50', 'PARSED'],
      ['TENANT', '1500.00', 'PARSED'],
    ]);
    const events = await api.runtime.prisma.outboxEvent.findMany({ where: { eventName: 'SmsBalanceLow' } });
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0]!.payload)).not.toMatch(/12\.5/);
    expect(
      (await api.runtime.prisma.providerCredential.findUniqueOrThrow({ where: { id: cred.id } })).status,
    ).toBe('ACTIVE');
    expect(logLines.join('\n')).toContain('older than ZAMANIT_KEY_MAX_AGE_DAYS');
  });
});
