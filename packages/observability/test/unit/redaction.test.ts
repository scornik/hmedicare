import { Writable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createLogger,
  normalizeBanglaDigits,
  redact,
  redactString,
  runWithLogContext,
} from '../../src/index';

// Provider-shaped keys are generated at runtime so no real-looking key is ever committed (TEST §3).
const alnum = (n: number) =>
  Array.from(
    randomBytes(n),
    (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[b % 62],
  ).join('');
const KEYS = {
  google: `AIza${alnum(35)}`,
  openai: `sk-${alnum(48)}`,
  groq: `gsk_${alnum(52)}`,
  anthropic: `sk-ant-${alnum(40)}`,
  openrouter: `sk-or-v1-${alnum(40)}`,
  zamanitFake: `zit_fake_${randomBytes(16).toString('hex')}`,
  sigkeyFake: `sigkey_fake_${randomBytes(16).toString('hex')}`,
};

describe('redactString value patterns (OBSERVABILITY.md §3.2)', () => {
  it.each(Object.entries(KEYS))('removes %s keys anywhere in text', (_label, key) => {
    const out = redactString(`provider said: invalid key ${key} (retry later)`);
    expect(out).not.toContain(key);
    expect(out).not.toContain(key.slice(-8));
    expect(out).toContain('[REDACTED:');
  });

  it('redacts bearer tokens and JWTs', () => {
    const jwt = `eyJ${alnum(20)}.eyJ${alnum(30)}.${alnum(40)}`;
    expect(redactString(`Authorization: Bearer ${jwt}`)).not.toContain(jwt);
    expect(redactString(`token ${jwt}`)).toContain('[REDACTED:jwt]');
  });

  it('masks Bangladesh phone numbers including Bangla digits', () => {
    expect(redactString('call +8801700000123 now')).toBe('call [REDACTED:phone] now');
    expect(redactString('call 01700000123 now')).toBe('call [REDACTED:phone] now');
    const bangla = '০১৭০০০০০১২৩';
    expect(normalizeBanglaDigits(bangla)).toBe('01700000123');
    expect(redactString(`ফোন ${bangla}`)).toBe('ফোন [REDACTED:phone]');
  });

  it('redacts emails, NID-length digit runs and URL query strings', () => {
    expect(redactString('mail demo.user@example.invalid')).toBe('mail [REDACTED:email]');
    expect(redactString('nid 1234567890123')).toBe('nid [REDACTED:nid]');
    expect(redactString('GET https://api.example.invalid/x?token=abc&b=1')).toBe(
      'GET https://api.example.invalid/x?[REDACTED:query]',
    );
  });

  it('redacts Zaman IT form bodies and aamarPay search URLs, keeping the key names', () => {
    const body = `api_key=${alnum(24)}&type=text&phone=8801700000123&senderid=HMEDIC`;
    const out = redactString(body);
    expect(out).toContain('api_key=[REDACTED:credential]');
    expect(out).not.toMatch(/api_key=[A-Za-z0-9]{8}/);
    expect(redactString(`failed: signature_key=${alnum(32)}&store_id=abcd`)).toBe(
      'failed: signature_key=[REDACTED:credential]&store_id=[REDACTED:credential]',
    );
  });

  it('keeps UUIDs (id allow-list) and ordinary text intact', () => {
    const id = '0199a1b2-3c4d-7e5f-8a9b-0c1d2e3f4a5b';
    expect(redactString(`job ${id} finished in 12 ms`)).toBe(`job ${id} finished in 12 ms`);
    expect(redactString('Tenant created')).toBe('Tenant created');
  });

  it('redacts generic high-entropy strings', () => {
    const blob = randomBytes(30).toString('base64');
    expect(redactString(`secret=${blob}`)).not.toContain(blob);
  });
});

describe('redact objects (OBSERVABILITY.md §3.1)', () => {
  it('removes sensitive keys at any depth, including arrays', () => {
    const input = {
      userId: '0199a1b2-3c4d-7e5f-8a9b-0c1d2e3f4a5b',
      headers: { authorization: 'Bearer x', cookie: '__Host-hm_rt=abc', 'x-request-id': 'r1' },
      body: { phone: '+8801700000123', password: 'p', items: [{ otpCode: '123456', ok: true }] },
      apiKey: KEYS.google,
    };
    const out = redact(input) as typeof input;
    expect(out.userId).toBe(input.userId);
    expect(out.headers.authorization).toBe('[REDACTED]');
    expect(out.headers.cookie).toBe('[REDACTED]');
    expect(out.body.phone).toBe('[REDACTED]');
    expect(out.body.password).toBe('[REDACTED]');
    expect(out.body.items[0]?.otpCode).toBe('[REDACTED]');
    expect(out.apiKey).toBe('[REDACTED]');
    expect(JSON.stringify(out)).not.toContain(KEYS.google);
  });

  it('redacts Error messages and stacks that contain key material', () => {
    const err = new Error(`upstream rejected key ${KEYS.openai} for +8801700000123`);
    const out = redact(err) as { message: string; stack: string };
    expect(out.message).not.toContain(KEYS.openai);
    expect(out.message).not.toContain('8801700000123');
    expect(out.stack).not.toContain(KEYS.openai);
  });

  it('handles circular structures', () => {
    const a: Record<string, unknown> = { id: 'x' };
    a.self = a;
    expect(redact(a)).toEqual({ id: 'x', self: '[CIRCULAR]' });
  });
});

describe('logger integration', () => {
  function capture() {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const logger = createLogger({
      app: 'api',
      env: 'test',
      version: 't',
      bootId: 'b',
      level: 'debug',
      destination: stream,
    });
    return { logger, lines };
  }

  it('never writes secrets, phones or cookies to the output', () => {
    const { logger, lines } = capture();
    logger.info(
      { headers: { cookie: 'a=b' }, phone: '+8801700000123' },
      `login from 01700000123 with ${KEYS.groq}`,
    );
    logger.error({ err: new Error(`bad ${KEYS.anthropic}`) }, 'provider failure');
    const all = lines.join('\n');
    for (const key of Object.values(KEYS)) expect(all).not.toContain(key);
    expect(all).not.toContain('8801700000123');
    expect(all).not.toContain('01700000123');
    expect(all).not.toContain('a=b');
  });

  it('binds correlation fields from the async context', () => {
    const { logger, lines } = capture();
    runWithLogContext({ requestId: 'req-1', correlationId: 'corr-1' }, () => logger.info('hello'));
    const line = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(line).toMatchObject({ requestId: 'req-1', correlationId: 'corr-1', app: 'api', msg: 'hello' });
  });

  it('stays within the performance budget (< 0.2 ms per typical line)', () => {
    const line = {
      requestId: '0199a1b2-3c4d-7e5f-8a9b-0c1d2e3f4a5b',
      route: '/api/v1/auth/otp/request',
      method: 'POST',
      status: 202,
      latencyMs: 12,
      msg: 'request completed',
    };
    const n = 2000;
    const start = performance.now();
    for (let i = 0; i < n; i++) redact(line);
    expect((performance.now() - start) / n).toBeLessThan(0.2);
  });
});
