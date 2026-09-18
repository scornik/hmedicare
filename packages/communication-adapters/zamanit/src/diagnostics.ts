import { isIP } from 'node:net';
import { connect } from 'node:tls';
import type { SmsBalanceResult, SmsCredentialHandle } from '@hmedic/communication';
import {
  NOT_SENT_CODES,
  type ZamanItConfig,
  errorCode,
  interpretBalanceResponse,
  zamanItTransportAllowed,
} from './zamanit-adapter';

/**
 * SMS-002 free probes (ZAMANIT-VERIFICATION §0, ZAMANIT-VER-01/02). `checkbalance` only: nothing is sent or
 * charged. The capture is redacted before it leaves this function: the API key and anything phone-shaped are
 * replaced, the body is capped, and the request URL carries no query string. TLS verification is never
 * disabled; certificate details are recorded only when the handshake verifies.
 */
export interface BalanceCapture {
  endpoint: string;
  transport: 'http' | 'https';
  outcome: 'response' | 'not_sent' | 'unknown' | 'transport_refused';
  errorCode: string | null;
  status: number | null;
  contentType: string | null;
  bodyRedacted: string | null;
  parsed: SmsBalanceResult;
  latencyMs: number;
}

export interface TlsProbeResult {
  host: string;
  port: number;
  verified: boolean;
  errorCode: string | null;
  subject: string | null;
  issuer: string | null;
  validTo: string | null;
}

export interface ZamanItBalanceDiagnostic {
  provider: 'zamanit';
  checkbalance: BalanceCapture;
  httpsProbe: TlsProbeResult;
}

const BODY_CAP = 2048;

/** Removes every secret occurrence and phone-shaped digit run (≥ 10 digits) from a provider body. */
export function redactProviderBody(raw: string, secrets: readonly string[]): string {
  let out = raw.slice(0, BODY_CAP);
  for (const s of secrets) if (s.length >= 4) out = out.split(s).join('[REDACTED_KEY]');
  return out.replace(/\+?\d[\d -]{8,}\d/g, (m) =>
    m.replace(/\D/g, '').length >= 10 ? '[REDACTED_PHONE]' : m,
  );
}

const cn = (v: string | string[] | undefined): string | null =>
  Array.isArray(v) ? v.join(', ') : (v ?? null);

/** TLS handshake with default verification against `host:port` (ZAMANIT-VER-01). */
export function probeTls(host: string, port = 443, timeoutMs = 8_000): Promise<TlsProbeResult> {
  return new Promise((resolve) => {
    const base = { host, port, subject: null, issuer: null, validTo: null };
    const socket = connect({ host, port, ...(isIP(host) ? {} : { servername: host }) });
    const done = (r: TlsProbeResult) => {
      socket.destroy();
      resolve(r);
    };
    socket.setTimeout(timeoutMs, () => done({ ...base, verified: false, errorCode: 'ETIMEDOUT' }));
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate();
      done({
        host,
        port,
        verified: socket.authorized,
        errorCode: socket.authorized ? null : String(socket.authorizationError ?? 'UNVERIFIED'),
        subject: socket.authorized ? cn(cert.subject?.CN) : null,
        issuer: socket.authorized ? cn(cert.issuer?.CN) : null,
        validTo: socket.authorized ? (cert.valid_to ?? null) : null,
      });
    });
    socket.once('error', (e: NodeJS.ErrnoException) =>
      done({ ...base, verified: false, errorCode: e.code ?? 'TLS_ERROR' }),
    );
  });
}

export async function probeZamanItBalance(
  config: ZamanItConfig & { tlsProbe?: typeof probeTls },
  credential: SmsCredentialHandle,
): Promise<ZamanItBalanceDiagnostic> {
  const base = config.baseUrl.replace(/\/+$/, '');
  const url = new URL(`${base}/checkbalance`);
  const endpoint = `${url.protocol}//${url.host}${url.pathname}`;
  const transport = url.protocol === 'https:' ? 'https' : 'http';
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const started = Date.now();

  let checkbalance: BalanceCapture;
  if (!(await zamanItTransportAllowed(config))) {
    checkbalance = {
      endpoint,
      transport,
      outcome: 'transport_refused',
      errorCode: null,
      status: null,
      contentType: null,
      bodyRedacted: null,
      parsed: { outcome: 'REJECTED', errorClass: 'TRANSPORT_REFUSED' },
      latencyMs: 0,
    };
  } else {
    checkbalance = await credential.withKey(async (apiKey) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const res = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            accept: 'application/json, text/plain, */*',
          },
          body: new URLSearchParams({ api_key: apiKey }).toString(),
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
        return {
          endpoint,
          transport,
          outcome: 'response' as const,
          errorCode: null,
          status: res.status,
          contentType: res.headers.get('content-type'),
          bodyRedacted: redactProviderBody(raw, [apiKey, encodeURIComponent(apiKey)]),
          parsed: interpretBalanceResponse({ status: res.status, body, raw }),
          latencyMs: Date.now() - started,
        };
      } catch (error) {
        const code = errorCode(error) ?? null;
        const notSent = code !== null && NOT_SENT_CODES.has(code);
        return {
          endpoint,
          transport,
          outcome: notSent ? ('not_sent' as const) : ('unknown' as const),
          errorCode: code,
          status: null,
          contentType: null,
          bodyRedacted: null,
          parsed: {
            outcome: 'ERROR' as const,
            errorClass: notSent ? ('PROVIDER_UNAVAILABLE' as const) : ('UNKNOWN_OUTCOME' as const),
          },
          latencyMs: Date.now() - started,
        };
      } finally {
        clearTimeout(timer);
      }
    });
  }

  const httpsProbe = await (config.tlsProbe ?? probeTls)(url.hostname, 443);
  return { provider: 'zamanit', checkbalance, httpsProbe };
}
