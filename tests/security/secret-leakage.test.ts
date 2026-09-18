import { readFileSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type ServerConfig, loadConfig } from '@hmedic/config';
import { testEnv } from '@hmedic/config/testing';
import { newId } from '@hmedic/kernel';
import { createLogger } from '@hmedic/observability';
import { OutboxPort } from '@hmedic/jobs';
import { platformSmsCredential, runSmsBalanceCheck } from '@hmedic/communication';
import { ZamanItSmsAdapter } from '@hmedic/communication-adapters-zamanit';
import { createProviderCredentialVault } from '@hmedic/provider-credentials/worker';
import { type ApiInstance, buildApi } from '../../apps/api/src/compose';
import { testDatabaseUrl, truncateAll } from '../support/db';

// T1/T2/T22 secret leakage: synthetic provider-shaped keys driven through credential create/resolve/
// revoke, SMS send/balance (incl. a provider error body that echoes the key) and HTTP error paths; then
// logs, ProblemDetails, job/dead-letter/outbox payloads, audit metadata, idempotency snapshots, DB rows
// and the generated OpenAPI documents are scanned for any key material.
const PLATFORM_KEY = 'zit_fake_0123456789abcdef0123456789abcdef';
const TENANT_KEY = 'zit_fake_fedcba9876543210fedcba9876543210';
const SHAPED = [
  `AIza${'A'.repeat(35)}`,
  `sk-${'b'.repeat(48)}`,
  `gsk_${'c'.repeat(52)}`,
  Buffer.from('synthetic-40-char-secret-value-for-test').toString('base64'),
];
const SECRETS = [PLATFORM_KEY, TENANT_KEY, ...SHAPED];
const fragments = (s: string) => [s, s.slice(-8), Buffer.from(s).toString('base64')];
const logLines: string[] = [];
let api: ApiInstance;
let server: Parameters<typeof request>[0];

/** Fake provider that echoes the key back in its error body (T2). */
const echoingFetch: typeof fetch = async (_url, init) => {
  const form = new URLSearchParams(String(init?.body ?? ''));
  return new Response(JSON.stringify({ error_code: 1001, message: `invalid key ${form.get('api_key')}` }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

beforeAll(async () => {
  api = await buildApi(
    loadConfig<ServerConfig>('api', testEnv({ DATABASE_URL: testDatabaseUrl(), LOG_LEVEL: 'trace' })),
  );
  api.runtime.logger = createLogger({
    app: 'api',
    env: 'test',
    version: 'test',
    bootId: api.runtime.bootId,
    level: 'trace',
    destination: { write: (l: string) => void logLines.push(l) },
  });
  server = api.app.getHttpServer();
});
afterAll(async () => {
  await api?.close();
});
beforeEach(async () => {
  await truncateAll();
});

async function dbDump(): Promise<string> {
  const p = api.runtime.prisma;
  const rows = await Promise.all([
    p.providerCredential.findMany(),
    p.auditLog.findMany({ select: { metadata: true, action: true } }),
    p.job.findMany({ select: { payload: true, lastErrorClass: true } }),
    p.deadLetter.findMany({ select: { payload: true, lastErrorClass: true } }),
    p.outboxEvent.findMany({ select: { payload: true } }),
    p.idempotencyRecord.findMany({ select: { responseSnapshot: true } }),
    p.smsBalanceSnapshot.findMany(),
  ]);
  return JSON.stringify(rows, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
}

describe('T1/T2/T22 no key material anywhere', () => {
  it('credential lifecycle, SMS paths and error paths leak no key', async () => {
    logLines.length = 0;
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
    const views = [];
    for (const k of [TENANT_KEY, ...SHAPED]) {
      views.push(
        await vault.create({
          tenantId,
          actorUserId: null,
          providerKind: 'SMS',
          providerCode: 'zamanit',
          environment: 'na',
          publicIdentifier: 'DEMO',
          bundle: { apiKey: k },
          last4Field: 'apiKey',
        }),
      );
    }
    // Resolve/use and log the handle object as careless code might.
    const handle = await vault.resolveForAdapter(tenantId, views[0]!.id);
    api.runtime.logger.info({ handle, view: views[0] }, 'credential handle');
    // Provider echoes the key in an error body (send and balance).
    const echo = new ZamanItSmsAdapter({
      baseUrl: 'https://provider.example.invalid/api',
      timeoutMs: 1000,
      allowInsecureHttp: false,
      appEnv: 'test',
      isHttpGateClosed: async () => true,
      fetch: echoingFetch,
    });
    const cred = platformSmsCredential(PLATFORM_KEY, 'DEMO');
    const sent = await echo.send({
      credential: cred,
      destination: '+8801700000093',
      text: 'x',
      purpose: 'OTP',
      correlationId: 'c',
    });
    const bal = await echo.checkBalance(cred);
    api.runtime.logger.warn({ sent, bal }, 'provider results');
    expect(JSON.stringify([sent, bal])).not.toContain(PLATFORM_KEY);
    await runSmsBalanceCheck({
      prisma: api.runtime.prisma,
      provider: echo,
      platform: cred,
      outbox: new OutboxPort(),
      platformAlertBdt: '500.00',
      keyMaxAgeDays: 90,
      logger: api.runtime.logger,
      metrics: api.runtime.metrics,
    });
    for (const v of views) await vault.revoke(tenantId, v.id, null);
    // HTTP error paths carrying key-shaped input.
    const problems = [
      await request(server)
        .post('/api/v1/auth/password/login')
        .set('idempotency-key', `leak-${Date.now()}`)
        .send({ email: 'x@example.invalid', password: PLATFORM_KEY }),
      await request(server).get('/internal/metrics').set('authorization', `Bearer ${SHAPED[1]}`),
      await request(server).get(`/api/v1/me?api_key=${PLATFORM_KEY}`),
    ];
    const haystacks = {
      logs: logLines.join('\n'),
      problems: JSON.stringify(problems.map((p) => p.body)),
      db: await dbDump(),
      openapi: ['openapi.v1.json', 'openapi.v1.oas30.json']
        .map((f) => readFileSync(path.resolve(__dirname, '../../packages/contracts/generated', f), 'utf8'))
        .join('\n'),
    };
    const leaks: string[] = [];
    for (const [where, text] of Object.entries(haystacks)) {
      for (const s of SECRETS)
        for (const f of fragments(s)) if (text.includes(f)) leaks.push(`${where}: ${f.slice(0, 6)}…`);
    }
    expect(leaks).toEqual([]);
    expect(logLines.length).toBeGreaterThan(3);
  });
});
