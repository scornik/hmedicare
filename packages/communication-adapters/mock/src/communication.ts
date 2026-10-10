import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type {
  CommunicationProvider,
  EmailProvider,
  WhatsAppProvider,
  PushProvider,
  SendCommunicationInput,
  ProviderSendResult,
  ProviderReceipt,
  ProviderStatus,
  NormalizedDeliveryStatus,
  WebhookInput,
} from '@hmedic/communication';

export type MockCommunicationScenario = 'success' | 'transient_failure' | 'permanent_failure' | 'rate_limit';
type Channel = 'email' | 'whatsapp' | 'push';

/** In-process test adapter. Stores hashes and synthetic results, never destinations or message text. */
export class MockCommunicationAdapter<C extends Channel> implements CommunicationProvider {
  readonly code: string;
  private readonly scenarios: MockCommunicationScenario[] = [];
  private readonly accepted = new Map<string, { fingerprint: string; result: ProviderSendResult }>();
  constructor(
    readonly channel: C,
    private readonly webhookSecret: string,
  ) {
    if (webhookSecret.length < 32) throw new Error('Mock webhook secret must contain at least 32 characters');
    this.code = `mock-${channel}`;
  }

  enqueue(...scenarios: MockCommunicationScenario[]): this {
    this.scenarios.push(...scenarios);
    return this;
  }

  async send(input: SendCommunicationInput): Promise<ProviderSendResult> {
    if (
      !input.tenantId ||
      !input.communicationId ||
      !input.attemptId ||
      !input.idempotencyKey ||
      !input.destination ||
      !input.text
    ) {
      return { outcome: 'PERMANENT_FAILURE', errorClass: 'INVALID_REQUEST' };
    }
    const key = JSON.stringify([input.tenantId, input.idempotencyKey]);
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const previous = this.accepted.get(key);
    if (previous) {
      return previous.fingerprint === fingerprint
        ? { ...previous.result }
        : { outcome: 'PERMANENT_FAILURE', errorClass: 'INVALID_REQUEST' };
    }
    const scenario = this.scenarios.shift() ?? 'success';
    if (scenario === 'transient_failure')
      return { outcome: 'TRANSIENT_FAILURE', errorClass: 'PROVIDER_UNAVAILABLE' };
    if (scenario === 'permanent_failure')
      return { outcome: 'PERMANENT_FAILURE', errorClass: 'DESTINATION_UNSUPPORTED' };
    if (scenario === 'rate_limit') return { outcome: 'RATE_LIMITED', retryAfterSeconds: 30 };
    const result: ProviderSendResult = {
      outcome: 'ACCEPTED',
      providerMessageId: `${this.code}-${createHash('sha256').update(key).digest('hex').slice(0, 32)}`,
    };
    this.accepted.set(key, { fingerprint, result: { ...result } });
    return result;
  }

  mapStatus(input: ProviderStatus): NormalizedDeliveryStatus {
    switch (input) {
      case 'accepted':
        return 'SENT';
      case 'delivered':
        return 'DELIVERED';
      case 'read':
        return 'READ';
      case 'failed':
        return 'FAILED';
      default:
        return 'UNKNOWN';
    }
  }

  async verifyWebhook(input: WebhookInput): Promise<ProviderReceipt | null> {
    if (input.rawBody.byteLength > 4096) return null;
    const signature = input.headers['x-mock-signature'];
    if (!signature || !/^[a-f0-9]{64}$/.test(signature)) return null;
    const expected = createHmac('sha256', this.webhookSecret).update(input.rawBody).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return null;
    try {
      const value: unknown = JSON.parse(Buffer.from(input.rawBody).toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const receipt = value as Record<string, unknown>;
      if (
        Object.keys(receipt).length !== 3 ||
        typeof receipt.eventId !== 'string' ||
        typeof receipt.messageId !== 'string' ||
        typeof receipt.status !== 'string'
      )
        return null;
      if (
        !/^[A-Za-z0-9_-]{1,191}$/.test(receipt.eventId) ||
        !/^[A-Za-z0-9_-]{1,191}$/.test(receipt.messageId)
      )
        return null;
      const status = this.mapStatus(receipt.status);
      if (status === 'UNKNOWN') return null;
      return {
        providerAdapter: this.code,
        providerEventId: receipt.eventId,
        providerMessageId: receipt.messageId,
        status,
      };
    } catch {
      return null;
    }
  }
}

export class MockEmailAdapter extends MockCommunicationAdapter<'email'> implements EmailProvider {
  constructor(secret: string) {
    super('email', secret);
  }
}
export class MockWhatsAppAdapter extends MockCommunicationAdapter<'whatsapp'> implements WhatsAppProvider {
  constructor(secret: string) {
    super('whatsapp', secret);
  }
}
export class MockPushAdapter extends MockCommunicationAdapter<'push'> implements PushProvider {
  constructor(secret: string) {
    super('push', secret);
  }
}
