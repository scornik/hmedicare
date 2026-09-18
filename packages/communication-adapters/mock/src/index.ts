import {
  type SmsBalanceResult,
  type SmsCredentialHandle,
  type SmsProvider,
  type SmsSendResult,
  estimateSegments,
} from '@hmedic/communication';

/**
 * In-process mock SMS provider (SMS-003) for local development and CI (`SMS_PROVIDER=mock`). Deterministic
 * scenarios mirror the mock-providers HTTP service. Never sends anything and never stores full phones or
 * message text (only the length and a masked destination).
 */
export type MockSmsScenario =
  | 'success'
  | 'e1001'
  | 'e1002'
  | 'e1003'
  | 'e1004'
  | 'e1005'
  | 'e1006'
  | 'e1007'
  | 'provider_unavailable'
  | 'unknown_outcome'
  | 'low_balance'
  | 'unparsed_balance';

const CODE_CLASS = {
  e1001: 'INVALID_CREDENTIAL',
  e1002: 'SENDER_ID_INVALID',
  e1003: 'INVALID_REQUEST',
  e1004: 'INVALID_REQUEST',
  e1005: 'DESTINATION_UNSUPPORTED',
  e1006: 'INSUFFICIENT_BALANCE',
  e1007: 'INVALID_DESTINATION_FORMAT',
} as const;

export class MockSmsAdapter implements SmsProvider {
  readonly code = 'mock' as const;
  private queue: MockSmsScenario[] = [];
  defaultScenario: MockSmsScenario = 'success';
  readonly sent: Array<{ destinationMasked: string; length: number; purpose: string; outcome: string }> = [];

  /** Next calls use these scenarios in order, then the default. */
  enqueue(...scenarios: MockSmsScenario[]): this {
    this.queue.push(...scenarios);
    return this;
  }

  private next(): MockSmsScenario {
    return this.queue.shift() ?? this.defaultScenario;
  }

  async send(input: {
    credential: SmsCredentialHandle;
    destination: string;
    text: string;
    purpose: 'OTP' | 'TRANSACTIONAL';
  }): Promise<SmsSendResult> {
    if (!/^\+8801[3-9][0-9]{8}$/.test(input.destination)) {
      return { outcome: 'REJECTED', errorClass: 'INVALID_DESTINATION_FORMAT' };
    }
    const s = this.next();
    const record = (outcome: string) =>
      this.sent.push({
        destinationMasked: `${input.destination.slice(0, 5)}*******${input.destination.slice(-2)}`,
        length: input.text.length,
        purpose: input.purpose,
        outcome,
      });
    if (s in CODE_CLASS) {
      const errorClass = CODE_CLASS[s as keyof typeof CODE_CLASS];
      record('REJECTED');
      return { outcome: 'REJECTED', errorClass, providerCode: s.slice(1) };
    }
    if (s === 'provider_unavailable') {
      record('PROVIDER_UNAVAILABLE');
      return { outcome: 'PROVIDER_UNAVAILABLE', errorClass: 'PROVIDER_UNAVAILABLE' };
    }
    if (s === 'unknown_outcome') {
      record('UNKNOWN_OUTCOME');
      return { outcome: 'UNKNOWN_OUTCOME', errorClass: 'UNKNOWN_OUTCOME' };
    }
    const { encoding, segments } = estimateSegments(input.text);
    record('ACCEPTED');
    return {
      outcome: 'ACCEPTED',
      providerMessageId: `mock-${this.sent.length}`,
      segmentsEstimated: segments,
      encoding,
    };
  }

  async checkBalance(): Promise<SmsBalanceResult> {
    const s = this.next();
    if (s === 'e1001') return { outcome: 'REJECTED', errorClass: 'INVALID_CREDENTIAL', providerCode: '1001' };
    if (s === 'provider_unavailable') return { outcome: 'ERROR', errorClass: 'PROVIDER_UNAVAILABLE' };
    if (s === 'unparsed_balance')
      return { outcome: 'OK', parseStatus: 'UNPARSED', balance: null, currencyText: null };
    return {
      outcome: 'OK',
      parseStatus: 'PARSED',
      balance: s === 'low_balance' ? '12.50' : '1500.00',
      currencyText: 'BDT',
    };
  }
}
