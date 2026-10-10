import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MockEmailAdapter, MockPushAdapter, MockWhatsAppAdapter } from '../../src/index';
import type { SendCommunicationInput, WebhookInput } from '@hmedic/communication';

const secret = 'synthetic-mock-webhook-secret-for-tests';
const input: SendCommunicationInput = {
  tenantId: 'tenant-a',
  communicationId: 'communication-a',
  attemptId: 'attempt-a',
  idempotencyKey: 'attempt-a',
  destination: 'synthetic@example.invalid',
  text: 'Your appointment is tomorrow',
  locale: 'en-BD',
};
function webhook(body: string): WebhookInput {
  const rawBody = Buffer.from(body);
  return {
    rawBody,
    headers: { 'x-mock-signature': createHmac('sha256', secret).update(rawBody).digest('hex') },
  };
}

describe.each([MockEmailAdapter, MockWhatsAppAdapter, MockPushAdapter])(
  'communication mock %s',
  (Adapter) => {
    it('replays an accepted attempt and rejects changed content without consuming the next scenario', async () => {
      const adapter = new Adapter(secret).enqueue('success', 'transient_failure');
      const result = await adapter.send(input);
      expect(result.outcome).toBe('ACCEPTED');
      expect(await adapter.send(input)).toEqual(result);
      expect(await adapter.send({ ...input, text: 'Changed' })).toEqual({
        outcome: 'PERMANENT_FAILURE',
        errorClass: 'INVALID_REQUEST',
      });
      expect(await adapter.send({ ...input, idempotencyKey: 'next' })).toEqual({
        outcome: 'TRANSIENT_FAILURE',
        errorClass: 'PROVIDER_UNAVAILABLE',
      });
    });

    it('isolates tenant keys and protects cached responses from caller mutation', async () => {
      const adapter = new Adapter(secret);
      const first = await adapter.send(input);
      if (first.outcome !== 'ACCEPTED') throw new Error('Expected success');
      const original = first.providerMessageId;
      first.providerMessageId = 'modified';
      expect(await adapter.send(input)).toEqual({ outcome: 'ACCEPTED', providerMessageId: original });
      expect(await adapter.send({ ...input, tenantId: 'tenant-b' })).not.toEqual({
        outcome: 'ACCEPTED',
        providerMessageId: original,
      });
    });

    it('allows retry after transient and rate-limit outcomes', async () => {
      const adapter = new Adapter(secret).enqueue('transient_failure', 'rate_limit', 'success');
      expect((await adapter.send(input)).outcome).toBe('TRANSIENT_FAILURE');
      expect(await adapter.send(input)).toEqual({ outcome: 'RATE_LIMITED', retryAfterSeconds: 30 });
      expect((await adapter.send(input)).outcome).toBe('ACCEPTED');
    });

    it('returns permanent failure and rejects empty inputs', async () => {
      const adapter = new Adapter(secret).enqueue('permanent_failure');
      expect(await adapter.send(input)).toEqual({
        outcome: 'PERMANENT_FAILURE',
        errorClass: 'DESTINATION_UNSUPPORTED',
      });
      expect(await adapter.send({ ...input, idempotencyKey: '' })).toEqual({
        outcome: 'PERMANENT_FAILURE',
        errorClass: 'INVALID_REQUEST',
      });
    });

    it('authenticates exact bytes and returns the same event identity for duplicate webhooks', async () => {
      const adapter = new Adapter(secret);
      const signed = webhook('{"eventId":"receipt-1","messageId":"mock-message-1","status":"delivered"}');
      const expected = {
        providerAdapter: adapter.code,
        providerEventId: 'receipt-1',
        providerMessageId: 'mock-message-1',
        status: 'DELIVERED',
      };
      expect(await adapter.verifyWebhook(signed)).toEqual(expected);
      expect(await adapter.verifyWebhook(signed)).toEqual(expected);
      expect(await adapter.verifyWebhook({ ...signed, rawBody: Buffer.from('changed') })).toBeNull();
      expect(await adapter.verifyWebhook({ ...signed, headers: {} })).toBeNull();
      expect(await adapter.verifyWebhook({ ...signed, headers: { 'x-mock-signature': 'a' } })).toBeNull();
      expect(await new Adapter('different-synthetic-secret-for-tests').verifyWebhook(signed)).toBeNull();
    });

    it('rejects signed malformed, oversized, unknown-status or extra-field receipts', async () => {
      const adapter = new Adapter(secret);
      for (const body of [
        '{',
        'null',
        '[]',
        '{}',
        '{"eventId":"e","messageId":"m","status":"new-status"}',
        '{"eventId":"e","messageId":"m","status":"read","text":"private"}',
        '{"eventId":"","messageId":"m","status":"read"}',
        ' '.repeat(4097),
      ]) {
        expect(await adapter.verifyWebhook(webhook(body))).toBeNull();
      }
      expect(adapter.mapStatus('accepted')).toBe('SENT');
      expect(adapter.mapStatus('failed')).toBe('FAILED');
      expect(adapter.mapStatus('unknown')).toBe('UNKNOWN');
      expect(() => new Adapter('short')).toThrow(/at least 32/);
    });
  },
);
