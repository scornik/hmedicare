import type {
  AICredentialHandle,
  AIErrorClass,
  AIGenerateInput,
  AIModelDescriptor,
  AIProvider,
  AIProviderResult,
  AdapterPolicyMetadata,
  AdapterTermsMetadata,
  DeclaredTier,
} from '@hmedic/ai';
import { GEMINI_PROVIDER_CODE, geminiMetadata } from './metadata';

/**
 * `GeminiApiAdapter` (ADAPT-003, ADR-017 §5).
 *
 * Translates between the `AIProvider` port and Google's Generative Language API. It decides nothing:
 * whether a call is permitted at all is settled by the policy engine before anything reaches here.
 *
 * Three constraints shaped the implementation.
 *
 * **The key never travels in a URL.** Google's API accepts `?key=`, and this adapter never uses it: a
 * query string reaches access logs, proxies and browser history, and BUILD-CONTRACT forbids a GET that
 * carries a secret. The key goes in `x-goog-api-key` on every request, including the model list.
 *
 * **Failures are results, not exceptions.** A thrown fetch error carries the request, and a Google
 * error body can quote the prompt that caused it. Only the status and Google's own status string are
 * kept, never its message.
 *
 * **`PROVIDER_UNAVAILABLE` is claimed only when it is provably true.** A connect or DNS failure means
 * nothing went out and a retry is free. A timeout after the request was written is
 * `UNKNOWN_OUTCOME`, because the model may well have run — treating that as retryable is how a job
 * gets executed twice.
 */
export const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

/** Transport errors that prove the request never went out. */
const NOT_SENT_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

export interface GeminiConfig {
  baseUrl?: string;
  timeoutMs?: number;
  /** Injected in tests. Production uses the default agent, so TLS verification is never bypassed. */
  fetch?: typeof globalThis.fetch;
}

interface GeminiModel {
  name?: unknown;
  displayName?: unknown;
  description?: unknown;
  inputTokenLimit?: unknown;
  supportedGenerationMethods?: unknown;
}

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

function errorCode(error: unknown): string | undefined {
  const e = error as { code?: unknown; cause?: { code?: unknown }; name?: unknown };
  const code = e?.cause?.code ?? e?.code;
  if (typeof code === 'string') return code;
  return typeof e?.name === 'string' ? e.name : undefined;
}

/**
 * Maps an HTTP status and Google's `status` string to the port's taxonomy.
 *
 * `RESOURCE_EXHAUSTED` arrives as 429 for both a per-minute rate limit and a spent daily quota, and
 * Google's body does not reliably distinguish them. It maps to `RATE_LIMITED`, which waits and leaves
 * the credential's status alone — guessing `QUOTA_EXHAUSTED` would settle a credential as spent on the
 * strength of one busy minute.
 */
export function classifyGeminiStatus(status: number, googleStatus?: string, reason?: string): AIErrorClass {
  // Google returns 400 INVALID_ARGUMENT both for a request this adapter built wrong and for a key it
  // rejects, so the status alone cannot tell them apart. The structured `reason` can: it is an enum in
  // Google's ErrorInfo detail, not prose, so reading it discloses nothing about the request.
  if (reason === 'API_KEY_INVALID' || reason === 'API_KEY_SERVICE_BLOCKED') return 'INVALID_CREDENTIAL';
  if (status === 401 || status === 403) return 'INVALID_CREDENTIAL';
  if (status === 404) return 'MODEL_UNAVAILABLE';
  if (status === 429) return 'RATE_LIMITED';
  // Reached Google and may have reached the model, so a retry is not provably free.
  if (status >= 500) return 'UNKNOWN_OUTCOME';
  // 400 with no key reason: this adapter sent something the API would not accept. Retrying the same
  // request changes nothing, and blaming the doctor's key for our own bad request would be worse.
  return 'PROVIDER_ERROR';
}

/** Google's ErrorInfo `reason` enum, where the body carries one. */
function reasonOf(body: unknown): string | undefined {
  const details = (body as { error?: { details?: unknown } } | undefined)?.error?.details;
  if (!Array.isArray(details)) return undefined;
  for (const detail of details) {
    const reason = str((detail as { reason?: unknown } | undefined)?.reason);
    if (reason) return reason;
  }
  return undefined;
}

export class GeminiApiAdapter implements AIProvider {
  readonly providerCode = GEMINI_PROVIDER_CODE;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly base: string;
  private readonly timeoutMs: number;

  constructor(config: GeminiConfig = {}) {
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    this.base = (config.baseUrl ?? GEMINI_DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  metadata(tier: DeclaredTier): AdapterPolicyMetadata & AdapterTermsMetadata {
    return geminiMetadata(tier);
  }

  /**
   * One request, with the key in a header and the body read as text before parsing.
   *
   * `kind` separates the three outcomes that matter: a response arrived, nothing was sent, or we
   * cannot tell. Only the caller knows which error class each means for the operation it was doing.
   */
  private async call(
    path: string,
    apiKey: string,
    init: { method: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal },
  ): Promise<
    { kind: 'response'; status: number; body: unknown } | { kind: 'not_sent' } | { kind: 'unknown' }
  > {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = () => controller.abort();
    init.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await this.fetchImpl(`${this.base}${path}`, {
        method: init.method,
        headers: {
          // Never `?key=`: a query string reaches access logs, proxies and history.
          'x-goog-api-key': apiKey,
          accept: 'application/json',
          ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: controller.signal,
        redirect: 'error',
      });
      // Capped: an error page can be large, and nothing beyond the status and Google's own status
      // string is used.
      const raw = (await res.text()).slice(0, 16_384);
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        body = undefined;
      }
      return { kind: 'response', status: res.status, body };
    } catch (error) {
      const code = errorCode(error);
      return code && NOT_SENT_CODES.has(code) ? { kind: 'not_sent' } : { kind: 'unknown' };
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', onAbort);
    }
  }

  private failure<T>(
    result: { kind: 'not_sent' } | { kind: 'unknown' } | { kind: 'response'; status: number; body: unknown },
  ): AIProviderResult<T> {
    if (result.kind === 'not_sent') {
      return { outcome: 'ERROR', errorClass: 'PROVIDER_UNAVAILABLE' };
    }
    if (result.kind === 'unknown') {
      // A timeout or an aborted lease after the request went out. The model may have run.
      return { outcome: 'ERROR', errorClass: 'UNKNOWN_OUTCOME' };
    }
    const error = (result.body as { error?: { status?: unknown } } | undefined)?.error;
    const googleStatus = str(error?.status);
    const reason = reasonOf(result.body);
    const errorClass = classifyGeminiStatus(result.status, googleStatus, reason);
    return {
      outcome: 'ERROR',
      errorClass,
      // Google's own status and reason enums only. Its `message` can quote the prompt that caused the
      // error, so the message is never kept.
      ...(googleStatus || reason ? { providerCode: reason ?? googleStatus! } : {}),
      ...(errorClass === 'RATE_LIMITED' ? { retryAfterSeconds: retryAfterOf(result.body) } : {}),
    };
  }

  async listModels(credential: AICredentialHandle): Promise<AIProviderResult<readonly AIModelDescriptor[]>> {
    const result = await credential.withKey((apiKey) =>
      this.call('/v1beta/models?pageSize=200', apiKey, { method: 'GET' }),
    );
    if (result.kind !== 'response' || result.status < 200 || result.status >= 300) {
      return this.failure(result);
    }
    const models = (result.body as { models?: unknown } | undefined)?.models;
    if (!Array.isArray(models)) {
      // A 200 whose body is not the documented shape is not something to guess at.
      return { outcome: 'ERROR', errorClass: 'PROVIDER_ERROR', providerCode: 'UNEXPECTED_BODY' };
    }
    const value: AIModelDescriptor[] = [];
    for (const entry of models as GeminiModel[]) {
      const name = str(entry.name);
      if (!name) continue;
      const methods = Array.isArray(entry.supportedGenerationMethods)
        ? entry.supportedGenerationMethods.filter((m): m is string => typeof m === 'string')
        : [];
      // Only models that can answer a generate call. A list that included embedding-only models would
      // put choices in the picker that fail when used.
      if (!methods.includes('generateContent')) continue;
      value.push({
        // `models/gemini-…` as Google returns it, with the collection prefix removed: the id used in a
        // request path is what belongs in the catalog.
        modelId: name.replace(/^models\//, ''),
        displayName: str(entry.displayName) ?? name,
        capabilities: ['text', 'json_schema'],
      });
    }
    return { outcome: 'OK', value };
  }

  /**
   * Validates a credential (AICRED-004).
   *
   * A model list is the cheapest call that proves a key works, and it carries no prompt — which is the
   * requirement, since validation happens before anyone has decided this credential may see patient
   * data.
   *
   * `tierSignal` is deliberately absent. The models response (`name`, `version`, token limits,
   * supported methods) says nothing about billing, and no other endpoint on the Generative Language
   * API reports account tier; re-checked 2026-10-13 for ADAPT-003, as AI-PROVIDER-REGISTER.md §3 asked.
   * So the doctor's declaration stands, the credential keeps `tier_self_declared`, and the UI says so.
   * Reporting a guessed tier would either block a valid paid key or quietly treat a free key as paid.
   */
  async validate(credential: AICredentialHandle): Promise<AIProviderResult<{ tierSignal?: DeclaredTier }>> {
    const listed = await this.listModels(credential);
    if (listed.outcome === 'ERROR') return listed;
    return { outcome: 'OK', value: {} };
  }

  async generate(
    credential: AICredentialHandle,
    input: AIGenerateInput,
  ): Promise<AIProviderResult<{ text: string }>> {
    if (input.signal?.aborted) {
      // The lease was already lost. Nothing is sent, and nothing is claimed about what a provider did.
      return { outcome: 'ERROR', errorClass: 'UNKNOWN_OUTCOME', providerCode: 'LEASE_LOST' };
    }
    const body = {
      contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
      generationConfig: {
        ...(input.maxOutputTokens !== undefined ? { maxOutputTokens: input.maxOutputTokens } : {}),
        ...(input.jsonSchema
          ? // Structured output. Server-side validation of the answer is still the caller's job: a
            // provider honouring a schema is a convenience, not a guarantee.
            { responseMimeType: 'application/json', responseSchema: input.jsonSchema }
          : {}),
      },
    };
    const result = await credential.withKey((apiKey) =>
      this.call(`/v1beta/models/${encodeURIComponent(input.modelId)}:generateContent`, apiKey, {
        method: 'POST',
        body,
        ...(input.signal ? { signal: input.signal } : {}),
      }),
    );
    if (result.kind !== 'response' || result.status < 200 || result.status >= 300) {
      return this.failure(result);
    }

    const payload = result.body as
      | {
          promptFeedback?: { blockReason?: unknown };
          candidates?: Array<{ finishReason?: unknown; content?: { parts?: Array<{ text?: unknown }> } }>;
        }
      | undefined;
    const blockReason = str(payload?.promptFeedback?.blockReason);
    if (blockReason) {
      // Google refused the prompt on its own policy grounds. A retry sends the same text.
      return { outcome: 'ERROR', errorClass: 'CONTENT_BLOCKED', providerCode: blockReason };
    }
    const candidate = payload?.candidates?.[0];
    const finishReason = str(candidate?.finishReason);
    if (finishReason === 'SAFETY' || finishReason === 'PROHIBITED_CONTENT') {
      return { outcome: 'ERROR', errorClass: 'CONTENT_BLOCKED', providerCode: finishReason };
    }
    const text = (candidate?.content?.parts ?? [])
      .map((part) => str(part.text) ?? '')
      .join('')
      .trim();
    if (text.length === 0) {
      // A 200 with no text, for a reason Google did not name. Not a refusal and not a success.
      return {
        outcome: 'ERROR',
        errorClass: 'PROVIDER_ERROR',
        providerCode: finishReason ?? 'EMPTY_RESPONSE',
      };
    }
    if (input.jsonSchema) {
      try {
        JSON.parse(text);
      } catch {
        // The schema was requested and the answer is not JSON. The caller validates the shape; this
        // only catches an answer that cannot be parsed at all.
        return { outcome: 'ERROR', errorClass: 'SCHEMA_INVALID', providerCode: 'UNPARSEABLE_JSON' };
      }
    }
    return { outcome: 'OK', value: { text }, usage: usageOf(result.body) };
  }
}

/** Google reports `retryDelay` as a duration string such as `17s` inside the error details. */
function retryAfterOf(body: unknown): number | undefined {
  const details = (body as { error?: { details?: unknown } } | undefined)?.error?.details;
  if (!Array.isArray(details)) return undefined;
  for (const detail of details) {
    const delay = str((detail as { retryDelay?: unknown } | undefined)?.retryDelay);
    const seconds = delay ? /^(\d{1,6})(?:\.\d+)?s$/u.exec(delay) : null;
    if (seconds) return Number(seconds[1]);
  }
  return undefined;
}

/** Provider-reported counts where present. Labelled an estimate wherever shown (AICRED-005). */
function usageOf(body: unknown): { inputTokens?: number; outputTokens?: number } | undefined {
  const usage = (body as { usageMetadata?: Record<string, unknown> } | undefined)?.usageMetadata;
  if (!usage) return undefined;
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
  const inputTokens = num(usage.promptTokenCount);
  const outputTokens = num(usage.candidatesTokenCount);
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
  };
}
