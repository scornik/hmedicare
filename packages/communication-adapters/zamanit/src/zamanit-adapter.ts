import {
  type SmsBalanceResult,
  type SmsCredentialHandle,
  type SmsErrorClass,
  type SmsProvider,
  type SmsSendResult,
  estimateSegments,
} from '@hmedic/communication';

/**
 * Zaman IT SMS adapter (ADR-018; SMS-004). Rules enforced here:
 * - POST with an `application/x-www-form-urlencoded` body only; the key is never in a URL, log or error;
 * - TLS verification is never disabled (default fetch agent only);
 * - one recipient per request; `+8801XXXXXXXXX` → `8801XXXXXXXXX`, anything else rejected before any call;
 * - `type=text` for GSM-7, else `unicode`; segment estimate reported;
 * - in production a plain-http base URL is refused unless `allowInsecureHttp` and an unexpired
 *   GATE-SMS-HTTP decision (`isHttpGateClosed`) — fails closed with TRANSPORT_REFUSED;
 * - response parsing is provisional until SMS-002 fixtures (ADR-018 §4): a code 1001–1007 → mapped class;
 *   2xx JSON without a code → ACCEPTED; 5xx, timeout after send or unparseable 2xx → UNKNOWN_OUTCOME;
 *   connect/DNS failure before the request is written → PROVIDER_UNAVAILABLE.
 */
export interface ZamanItConfig {
  baseUrl: string;
  timeoutMs: number;
  allowInsecureHttp: boolean;
  appEnv: 'development' | 'test' | 'staging' | 'production';
  /** GateDecisionReader.isClosed('GATE-SMS-HTTP', 'production'). */
  isHttpGateClosed: () => Promise<boolean>;
  fetch?: typeof globalThis.fetch;
}

export const ERROR_CODE_CLASS: Readonly<Record<number, SmsErrorClass>> = {
  1001: 'INVALID_CREDENTIAL',
  1002: 'SENDER_ID_INVALID',
  1003: 'INVALID_REQUEST',
  1004: 'INVALID_REQUEST',
  1005: 'DESTINATION_UNSUPPORTED',
  1006: 'INSUFFICIENT_BALANCE',
  1007: 'INVALID_DESTINATION_FORMAT',
};

const PROVIDER_PHONE_RE = /^8801[3-9][0-9]{8}$/;
/** Connection failures that happen before any request byte reaches the provider. */
const NOT_SENT_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
]);

export function toProviderPhone(e164: string): string | null {
  const digits = e164.startsWith('+') ? e164.slice(1) : '';
  return PROVIDER_PHONE_RE.test(digits) ? digits : null;
}

/** Finds a provider error code (1001–1007) used as a value in a JSON body or as a bare token in text. */
export function findErrorCode(body: unknown, raw: string): number | null {
  const visit = (v: unknown): number | null => {
    if (typeof v === 'number' && ERROR_CODE_CLASS[v]) return v;
    if (typeof v === 'string' && /^100[1-7]$/.test(v.trim())) return Number(v.trim());
    if (v && typeof v === 'object') {
      for (const x of Object.values(v as Record<string, unknown>)) {
        const found = visit(x);
        if (found) return found;
      }
    }
    return null;
  };
  if (body !== undefined) return visit(body);
  const m = /(?:^|[^0-9])(100[1-7])(?:[^0-9]|$)/.exec(raw);
  return m ? Number(m[1]) : null;
}

function errorCode(error: unknown): string | undefined {
  const e = error as { code?: unknown; cause?: { code?: unknown } };
  const c = e?.cause?.code ?? e?.code;
  return typeof c === 'string' ? c : undefined;
}

export class ZamanItSmsAdapter implements SmsProvider {
  readonly code = 'zamanit' as const;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly base: string;

  constructor(private readonly config: ZamanItConfig) {
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    this.base = config.baseUrl.replace(/\/+$/, '');
  }

  /** Fail-closed transport check (ADR-018 §2). */
  private async transportAllowed(): Promise<boolean> {
    if (this.base.startsWith('https://')) return true;
    if (!this.base.startsWith('http://')) return false;
    if (!this.config.allowInsecureHttp) return false;
    if (this.config.appEnv !== 'production') return true;
    return this.config.isHttpGateClosed();
  }

  private async post(
    path: 'sendsms' | 'checkbalance',
    form: Record<string, string>,
  ): Promise<
    | { kind: 'response'; status: number; body: unknown; raw: string }
    | { kind: 'not_sent' }
    | { kind: 'unknown' }
  > {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.base}/${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json, text/plain, */*',
        },
        body: new URLSearchParams(form).toString(),
        signal: controller.signal,
        redirect: 'error',
      });
      const raw = (await res.text()).slice(0, 4096);
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        body = undefined;
      }
      return { kind: 'response', status: res.status, body, raw };
    } catch (error) {
      const code = errorCode(error);
      return code && NOT_SENT_CODES.has(code) ? { kind: 'not_sent' } : { kind: 'unknown' };
    } finally {
      clearTimeout(timer);
    }
  }

  async send(input: Parameters<SmsProvider['send']>[0]): Promise<SmsSendResult> {
    const phone = toProviderPhone(input.destination);
    if (!phone) return { outcome: 'REJECTED', errorClass: 'INVALID_DESTINATION_FORMAT' };
    if (!(await this.transportAllowed())) return { outcome: 'REJECTED', errorClass: 'TRANSPORT_REFUSED' };
    const { encoding, segments } = estimateSegments(input.text);
    const r = await input.credential.withKey((apiKey) =>
      this.post('sendsms', {
        api_key: apiKey,
        type: encoding,
        phone,
        senderid: input.credential.senderId,
        message: input.text,
      }),
    );
    if (r.kind === 'not_sent') return { outcome: 'PROVIDER_UNAVAILABLE', errorClass: 'PROVIDER_UNAVAILABLE' };
    if (r.kind === 'unknown' || r.status >= 500)
      return { outcome: 'UNKNOWN_OUTCOME', errorClass: 'UNKNOWN_OUTCOME' };
    const code = findErrorCode(r.body, r.raw);
    if (code) return { outcome: 'REJECTED', errorClass: ERROR_CODE_CLASS[code]!, providerCode: String(code) };
    if (r.status >= 200 && r.status < 300 && r.body !== undefined) {
      return { outcome: 'ACCEPTED', segmentsEstimated: segments, encoding };
    }
    return { outcome: 'UNKNOWN_OUTCOME', errorClass: 'UNKNOWN_OUTCOME' };
  }

  async checkBalance(credential: SmsCredentialHandle): Promise<SmsBalanceResult> {
    if (!(await this.transportAllowed())) return { outcome: 'REJECTED', errorClass: 'TRANSPORT_REFUSED' };
    const r = await credential.withKey((apiKey) => this.post('checkbalance', { api_key: apiKey }));
    if (r.kind === 'not_sent') return { outcome: 'ERROR', errorClass: 'PROVIDER_UNAVAILABLE' };
    if (r.kind === 'unknown' || r.status >= 500) return { outcome: 'ERROR', errorClass: 'UNKNOWN_OUTCOME' };
    const code = findErrorCode(r.body, r.raw);
    if (code) return { outcome: 'REJECTED', errorClass: ERROR_CODE_CLASS[code]!, providerCode: String(code) };
    const b = r.body as { balance?: unknown; currency?: unknown } | undefined;
    const value =
      typeof b?.balance === 'number' ? String(b.balance) : typeof b?.balance === 'string' ? b.balance : null;
    if (value !== null && /^\d{1,10}(\.\d{1,2})?$/.test(value.trim())) {
      return {
        outcome: 'OK',
        parseStatus: 'PARSED',
        balance: Number(value).toFixed(2),
        currencyText: typeof b?.currency === 'string' ? b.currency.slice(0, 8) : 'BDT',
      };
    }
    return { outcome: 'OK', parseStatus: 'UNPARSED', balance: null, currencyText: null };
  }
}
