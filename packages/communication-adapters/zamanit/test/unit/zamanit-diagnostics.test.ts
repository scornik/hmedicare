import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import type { SmsCredentialHandle } from '@hmedic/communication';
import {
  type TlsProbeResult,
  type ZamanItConfig,
  probeTls,
  probeZamanItBalance,
  redactProviderBody,
} from '../../src/index';

// SMS-002 free-probe capture (ZAMANIT-VERIFICATION §0): redaction, transport rules, TLS never disabled.
const KEY = 'zit_fake_0123456789abcdef0123456789abcdef';
const credential: SmsCredentialHandle = {
  scope: 'PLATFORM',
  credentialId: null,
  tenantId: null,
  senderId: 'DEMO',
  withKey: (fn) => fn(KEY),
};
const noTls: typeof probeTls = async (host: string, port = 443): Promise<TlsProbeResult> => ({
  host,
  port,
  verified: false,
  errorCode: 'ECONNREFUSED',
  subject: null,
  issuer: null,
  validTo: null,
});

function config(
  over: Partial<ZamanItConfig> & { fetch: typeof fetch },
): ZamanItConfig & { tlsProbe: typeof probeTls } {
  return {
    baseUrl: 'http://203.0.113.10/api',
    timeoutMs: 2_000,
    allowInsecureHttp: true,
    appEnv: 'staging',
    isHttpGateClosed: async () => false,
    tlsProbe: noTls,
    ...over,
  };
}

describe('SMS-002 checkbalance probe', () => {
  it('captures status and a redacted body; key only in the form body, never in the URL', async () => {
    const seen: Array<{ url: string; body: string; method: string }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, body: String(init.body), method: String(init.method) });
      return new Response(JSON.stringify({ balance: '1234.50', echo: KEY, note: 'sent to 8801700000001' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const d = await probeZamanItBalance(config({ fetch: fetchImpl }), credential);

    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe('POST');
    expect(seen[0]!.url).toBe('http://203.0.113.10/api/checkbalance');
    expect(seen[0]!.body).toContain('api_key=');
    expect(d.checkbalance).toMatchObject({
      outcome: 'response',
      status: 200,
      transport: 'http',
      contentType: 'application/json',
      parsed: { outcome: 'OK', parseStatus: 'PARSED', balance: '1234.50' },
    });
    const serialized = JSON.stringify(d);
    expect(serialized).not.toContain(KEY);
    expect(serialized).not.toContain('8801700000001');
    expect(d.checkbalance.bodyRedacted).toContain('[REDACTED_KEY]');
    expect(d.checkbalance.bodyRedacted).toContain('[REDACTED_PHONE]');
    expect(d.httpsProbe).toMatchObject({ host: '203.0.113.10', port: 443, verified: false });
  });

  it('maps provider error codes (wrong key → 1001) and refuses plain http without the flag', async () => {
    const err = (async () =>
      new Response('{"error":1001}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    const d = await probeZamanItBalance(config({ fetch: err }), credential);
    expect(d.checkbalance.parsed).toEqual({
      outcome: 'REJECTED',
      errorClass: 'INVALID_CREDENTIAL',
      providerCode: '1001',
    });

    let called = false;
    const never = (async () => {
      called = true;
      return new Response('{}');
    }) as unknown as typeof fetch;
    const refused = await probeZamanItBalance(config({ fetch: never, allowInsecureHttp: false }), credential);
    expect(called).toBe(false);
    expect(refused.checkbalance.outcome).toBe('transport_refused');

    const prod = await probeZamanItBalance(config({ fetch: never, appEnv: 'production' }), credential);
    expect(called).toBe(false);
    expect(prod.checkbalance.parsed).toMatchObject({ errorClass: 'TRANSPORT_REFUSED' });
  });

  it('connection failures are classified without leaking the key', async () => {
    const down = (async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }) as unknown as typeof fetch;
    const d = await probeZamanItBalance(config({ fetch: down }), credential);
    expect(d.checkbalance).toMatchObject({
      outcome: 'not_sent',
      errorCode: 'ECONNREFUSED',
      parsed: { outcome: 'ERROR', errorClass: 'PROVIDER_UNAVAILABLE' },
    });
    expect(JSON.stringify(d)).not.toContain(KEY);
  });

  it('redactProviderBody removes keys and phone-shaped runs but keeps short numbers', () => {
    const out = redactProviderBody(`key=${KEY} bal 1234.50 code 1006 to +880 1700-000001`, [KEY]);
    expect(out).toBe('key=[REDACTED_KEY] bal 1234.50 code 1006 to [REDACTED_PHONE]');
  });

  it('TLS probe verifies by default and reports the failure code (no cert details when unverified)', async () => {
    // A plain TCP listener: the TLS handshake cannot succeed, so verification must fail closed.
    const server = createServer((s) => s.end('not tls\n'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    const r = await probeTls('127.0.0.1', port, 3_000);
    server.close();
    expect(r.verified).toBe(false);
    expect(r.errorCode).not.toBeNull();
    expect(r.subject).toBeNull();
  });
});
