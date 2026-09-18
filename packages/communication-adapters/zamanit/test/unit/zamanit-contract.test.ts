import { type ChildProcess, spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SmsCredentialHandle } from '@hmedic/communication';
import { ZamanItSmsAdapter, findErrorCode, toProviderPhone } from '../../src/index';

// SMS-004 contract tests against the mock-providers HTTP service (ADR-018 §9, COMMUNICATION §6.5, T27/T28).
const KEY = 'zit_fake_0123456789abcdef0123456789abcdef';
const SERVER = path.resolve(__dirname, '../../../../../infrastructure/docker/mock-providers/server.mjs');
let child: ChildProcess;
let port = 0;
let base = '';

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

const credential: SmsCredentialHandle = {
  scope: 'PLATFORM',
  credentialId: null,
  tenantId: null,
  senderId: 'DEMO',
  withKey: (fn) => fn(KEY),
};

const adapter = (over: Partial<ConstructorParameters<typeof ZamanItSmsAdapter>[0]> = {}) =>
  new ZamanItSmsAdapter({
    baseUrl: `${base}/zamanit/api`,
    timeoutMs: 2_000,
    allowInsecureHttp: true,
    appEnv: 'test',
    isHttpGateClosed: async () => false,
    ...over,
  });

const mock = (p: string, body?: unknown) =>
  fetch(`${base}${p}`, {
    method: body === undefined && p.endsWith('requests') ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).then((r) => r.json() as Promise<Record<string, unknown>>);

const requests = async () =>
  ((await mock('/__mock/zamanit/requests')).requests as Array<Record<string, unknown>>) ?? [];
const scenario = (name: string) => mock('/__mock/zamanit/scenario', { scenario: name });
const send = (a = adapter(), destination = '+8801700000061', text = 'HMedic login code: 123456') =>
  a.send({ credential, destination, text, purpose: 'OTP', correlationId: 'c1' });

beforeAll(async () => {
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('mock-providers did not start');
});
afterAll(() => {
  child?.kill();
});
beforeEach(async () => {
  await mock('/__mock/reset', {});
});

describe('ZamanItSmsAdapter — transport and format', () => {
  it('sends one POST form request; the key is in the body only, never in the URL or the result', async () => {
    const r = await send();
    expect(r).toMatchObject({ outcome: 'ACCEPTED', encoding: 'text', segmentsEstimated: 1 });
    expect(JSON.stringify(r)).not.toContain(KEY);
    const [req] = await requests();
    expect(req).toMatchObject({
      method: 'POST',
      endpoint: 'sendsms',
      contentType: 'application/x-www-form-urlencoded',
      queryPresent: false,
      apiKeyPresent: true,
      type: 'text',
      senderid: 'DEMO',
      phoneMasked: '**********061',
    });
  });

  it('uses type=unicode for Bangla text', async () => {
    const r = await send(adapter(), '+8801700000061', 'লগইন কোড ১২৩৪৫৬');
    expect(r).toMatchObject({ outcome: 'ACCEPTED', encoding: 'unicode' });
    expect((await requests())[0]).toMatchObject({ type: 'unicode' });
  });

  it('rejects malformed destinations before any network call', async () => {
    for (const d of ['01700000061', '+911700000061', '+8801200000061', '+৮৮০১৭০০০০০০৬১', '8801700000061']) {
      expect(await send(adapter(), d)).toEqual({
        outcome: 'REJECTED',
        errorClass: 'INVALID_DESTINATION_FORMAT',
      });
    }
    expect(await requests()).toHaveLength(0);
    expect(toProviderPhone('+8801700000061')).toBe('8801700000061');
  });
});

describe('ZamanItSmsAdapter — error mapping (ADR-018 §4)', () => {
  it.each([
    ['e1001', 'INVALID_CREDENTIAL'],
    ['e1002', 'SENDER_ID_INVALID'],
    ['e1003', 'INVALID_REQUEST'],
    ['e1004', 'INVALID_REQUEST'],
    ['e1005', 'DESTINATION_UNSUPPORTED'],
    ['e1006', 'INSUFFICIENT_BALANCE'],
    ['e1007', 'INVALID_DESTINATION_FORMAT'],
  ])('%s → %s', async (s, errorClass) => {
    await scenario(s);
    expect(await send()).toEqual({ outcome: 'REJECTED', errorClass, providerCode: s.slice(1) });
  });

  it('5xx and unparseable 2xx bodies are UNKNOWN_OUTCOME', async () => {
    await scenario('http500');
    expect((await send()).outcome).toBe('UNKNOWN_OUTCOME');
    await scenario('unparseable');
    expect((await send()).outcome).toBe('UNKNOWN_OUTCOME');
  });

  it('a timeout after the request was sent is UNKNOWN_OUTCOME', async () => {
    await scenario('timeout_after_send');
    expect(await send(adapter({ timeoutMs: 300 }))).toEqual({
      outcome: 'UNKNOWN_OUTCOME',
      errorClass: 'UNKNOWN_OUTCOME',
    });
  });

  it('a refused connection is PROVIDER_UNAVAILABLE (provably not sent)', async () => {
    const closed = await freePort();
    const r = await send(adapter({ baseUrl: `http://127.0.0.1:${closed}/zamanit/api` }));
    expect(r).toEqual({ outcome: 'PROVIDER_UNAVAILABLE', errorClass: 'PROVIDER_UNAVAILABLE' });
  });

  it('finds codes only as values', () => {
    expect(findErrorCode({ error_code: 1006 }, '')).toBe(1006);
    expect(findErrorCode({ result: { code: '1001' } }, '')).toBe(1001);
    expect(findErrorCode({ balance: '10010.00' }, '')).toBeNull();
    expect(findErrorCode(undefined, 'ERROR 1002: sender')).toBe(1002);
    expect(findErrorCode(undefined, 'id 91005x')).toBeNull();
  });
});

describe('ZamanItSmsAdapter — production plain-HTTP gate (T28)', () => {
  it('refuses http:// in production without the flag or without an unexpired gate decision', async () => {
    const noFlag = adapter({
      appEnv: 'production',
      allowInsecureHttp: false,
      isHttpGateClosed: async () => true,
    });
    expect(await send(noFlag)).toEqual({ outcome: 'REJECTED', errorClass: 'TRANSPORT_REFUSED' });
    const gateOpen = adapter({
      appEnv: 'production',
      allowInsecureHttp: true,
      isHttpGateClosed: async () => false,
    });
    expect(await send(gateOpen)).toEqual({ outcome: 'REJECTED', errorClass: 'TRANSPORT_REFUSED' });
    expect(await requests()).toHaveLength(0);
    const accepted = adapter({
      appEnv: 'production',
      allowInsecureHttp: true,
      isHttpGateClosed: async () => true,
    });
    expect((await send(accepted)).outcome).toBe('ACCEPTED');
  });

  it('refuses http:// anywhere unless explicitly allowed', async () => {
    expect(await send(adapter({ allowInsecureHttp: false }))).toEqual({
      outcome: 'REJECTED',
      errorClass: 'TRANSPORT_REFUSED',
    });
  });
});

describe('ZamanItSmsAdapter — balance', () => {
  it('parses the balance, flags low balance via value, maps 1001, and never sends', async () => {
    expect(await adapter().checkBalance(credential)).toEqual({
      outcome: 'OK',
      parseStatus: 'PARSED',
      balance: '1500.00',
      currencyText: 'BDT',
    });
    await scenario('low_balance');
    expect(await adapter().checkBalance(credential)).toMatchObject({ balance: '12.50' });
    await scenario('e1001');
    expect(await adapter().checkBalance(credential)).toEqual({
      outcome: 'REJECTED',
      errorClass: 'INVALID_CREDENTIAL',
      providerCode: '1001',
    });
    await scenario('unparseable');
    expect(await adapter().checkBalance(credential)).toEqual({
      outcome: 'OK',
      parseStatus: 'UNPARSED',
      balance: null,
      currencyText: null,
    });
    expect((await requests()).every((r) => r.endpoint === 'checkbalance' && r.method === 'POST')).toBe(true);
  });
});
