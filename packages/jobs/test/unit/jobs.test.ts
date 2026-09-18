import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '@hmedic/kernel';
import {
  IDEMPOTENCY_KEY_RE,
  JobPayloadError,
  JobPort,
  JobRegistry,
  NonRetryableJobError,
  RateLimitedJobError,
  SubscriptionRegistry,
  backoffDelayMs,
  errorClassOf,
  requestHash,
} from '../../src/index';

describe('backoffDelayMs (ADR-015 §3)', () => {
  const policy = { baseMs: 5_000, maxMs: 30 * 60_000 };
  it('grows exponentially with jitter in [0.5, 1.0]', () => {
    expect(backoffDelayMs(1, policy, () => 0)).toBe(2_500);
    expect(backoffDelayMs(1, policy, () => 1)).toBe(5_000);
    expect(backoffDelayMs(3, policy, () => 1)).toBe(20_000);
  });
  it('is capped at maxMs', () => {
    expect(backoffDelayMs(30, policy, () => 1)).toBe(policy.maxMs);
  });
});

describe('JobRegistry', () => {
  it('rejects duplicate types and unknown lookups', () => {
    const r = new JobRegistry().register({
      type: 'A',
      queue: 'q',
      payloadSchema: z.object({ v: z.literal(1) }),
    });
    expect(() => r.register({ type: 'A', queue: 'q', payloadSchema: z.any() })).toThrow(/twice/);
    expect(() => r.require('B')).toThrow(/unknown job type/);
    expect(r.queues()).toEqual(['q']);
  });
});

describe('payload deny-list (EVENT-ARCHITECTURE §5, T-payload)', () => {
  const registry = new JobRegistry().register({
    type: 'Probe',
    queue: 'q',
    payloadSchema: z.object({ v: z.literal(1) }).passthrough(),
  });
  const port = new JobPort(null as never, registry);
  it.each([
    [{ v: 1, phone: 'x' }],
    [{ v: 1, patientName: 'x' }],
    [{ v: 1, nested: { email: 'x' } }],
    [{ v: 1, otpCode: 'x', token: 'y' }],
    [{ v: 1, items: [{ address: 'x' }] }],
  ])('refuses PHI/secret keys %j', (payload) => {
    expect(() => port.validatePayload('Probe', payload)).toThrow(JobPayloadError);
  });
  it('accepts id/enum payloads and refuses schema violations', () => {
    expect(port.validatePayload('Probe', { v: 1, tenantId: 'x', status: 'SENT' })).toMatchObject({ v: 1 });
    expect(() => port.validatePayload('Probe', { v: 2 })).toThrow(JobPayloadError);
  });
  it('does not echo values in the error', () => {
    try {
      port.validatePayload('Probe', { v: 1, phone: '+8801700000001' });
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('8801700000001');
    }
  });
});

describe('error classes', () => {
  it('classifies errors without messages', () => {
    expect(errorClassOf(new NonRetryableJobError('JOB_TYPE_UNSUPPORTED'))).toBe('JOB_TYPE_UNSUPPORTED');
    expect(errorClassOf(new RateLimitedJobError(new Date()))).toBe('RATE_LIMITED');
    expect(errorClassOf(new AppError('PROVIDER_UNAVAILABLE'))).toBe('PROVIDER_UNAVAILABLE');
  });
});

describe('SubscriptionRegistry', () => {
  it('refuses duplicate handler subscriptions', () => {
    const s = new SubscriptionRegistry().subscribe('E', { handler: 'H' });
    expect(() => s.subscribe('E', { handler: 'H' })).toThrow();
    expect(s.for('E')).toHaveLength(1);
    expect(s.for('X')).toHaveLength(0);
  });
});

describe('idempotency request hash', () => {
  it('is stable under key order and sensitive to body changes', () => {
    const a = requestHash({ method: 'post', path: '/x', body: { a: 1, b: { c: 2, d: 3 } } });
    const b = requestHash({ method: 'POST', path: '/x', body: { b: { d: 3, c: 2 }, a: 1 } });
    const c = requestHash({ method: 'POST', path: '/x', body: { a: 2, b: { c: 2, d: 3 } } });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
  it('validates the Idempotency-Key format', () => {
    expect(IDEMPOTENCY_KEY_RE.test('0198a3b2-7c3e-7000-8000-000000000001')).toBe(true);
    expect(IDEMPOTENCY_KEY_RE.test('short')).toBe(false);
    expect(IDEMPOTENCY_KEY_RE.test('has space inside key')).toBe(false);
  });
});
