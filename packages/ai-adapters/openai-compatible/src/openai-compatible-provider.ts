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
import {
  OPENAI_COMPATIBLE_PROFILES,
  type OpenAICompatibleProviderCode,
  isOpenAICompatibleProviderCode,
  openAICompatibleMetadata,
} from './metadata';

/**
 * `OpenAICompatibleAdapter` (ADAPT-004, ADR-017 §5).
 *
 * One adapter for every provider that speaks the OpenAI chat-completions protocol: `openai`, `groq`,
 * `mistral`, `openrouter` and `deepseek`. The wire shape is shared; the terms are not, which is why
 * the metadata table is separate and per `(providerCode, tier)`.
 *
 * One instance serves exactly one provider code. A single instance answering for several would make
 * `metadata(tier)` ambiguous, and the register keys adapters by code — so composition creates one per
 * enabled provider, each with the base URL from its register row.
 *
 * `json_schema` is only sent to a provider whose register row claims it. For `groq` the register
 * records schema support as unverified, so a schema request is refused rather than sent in the hope
 * that it works: a provider silently ignoring `response_format` returns prose where the caller expects
 * JSON, and the caller's parse failure would be blamed on the model instead of on the capability
 * claim.
 *
 * Failures are results, never exceptions, and only status codes and the provider's own error `code`
 * or `type` are kept. An OpenAI-style `error.message` routinely quotes the request that caused it.
 */
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

export interface OpenAICompatibleConfig {
  providerCode: OpenAICompatibleProviderCode;
  /** Defaults to the base URL in the provider's register row. */
  baseUrl?: string;
  timeoutMs?: number;
  /** Injected in tests. Production uses the default agent, so TLS verification is never bypassed. */
  fetch?: typeof globalThis.fetch;
}

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

function errorCode(error: unknown): string | undefined {
  const e = error as { code?: unknown; cause?: { code?: unknown }; name?: unknown };
  const code = e?.cause?.code ?? e?.code;
  if (typeof code === 'string') return code;
  return typeof e?.name === 'string' ? e.name : undefined;
}

/**
 * Maps an HTTP status to the port's taxonomy.
 *
 * 401 and 403 are the key; 404 is the model, since a chat completion names the model in the body and
 * every provider here answers 404 for one it does not have. 429 is `RATE_LIMITED` rather than
 * `QUOTA_EXHAUSTED` for the same reason as elsewhere: a wait leaves the credential alone, while
 * settling it as spent on one busy minute would take a working key out of service.
 */
export function classifyOpenAIStatus(status: number): AIErrorClass {
  if (status === 401 || status === 403) return 'INVALID_CREDENTIAL';
  if (status === 404) return 'MODEL_UNAVAILABLE';
  if (status === 429) return 'RATE_LIMITED';
  // Reached the provider and may have reached the model, so a retry is not provably free.
  if (status >= 500) return 'UNKNOWN_OUTCOME';
  return 'PROVIDER_ERROR';
}

export class OpenAICompatibleAdapter implements AIProvider {
  readonly providerCode: OpenAICompatibleProviderCode;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly base: string;
  private readonly timeoutMs: number;

  constructor(config: OpenAICompatibleConfig) {
    if (!isOpenAICompatibleProviderCode(config.providerCode)) {
      // Refusing at construction rather than at the first call: a provider this adapter has no
      // register row for has no classification, and composing it would put an unclassified credential
      // within reach of the policy engine.
      throw new Error(`no OpenAI-compatible register row for ${config.providerCode}`);
    }
    this.providerCode = config.providerCode;
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    this.base = (config.baseUrl ?? OPENAI_COMPATIBLE_PROFILES[config.providerCode].baseUrl).replace(
      /\/+$/,
      '',
    );
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  metadata(tier: DeclaredTier): (AdapterPolicyMetadata & AdapterTermsMetadata) | null {
    return openAICompatibleMetadata(this.providerCode, tier);
  }

  private supports(tier: DeclaredTier, capability: 'text' | 'json_schema'): boolean {
    return this.metadata(tier)?.capabilities.includes(capability) ?? false;
  }

  private async call(
    path: string,
    apiKey: string,
    init: { method: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal },
  ): Promise<
    | { kind: 'response'; status: number; body: unknown; retryAfter?: string }
    | { kind: 'not_sent' }
    | { kind: 'unknown' }
  > {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = () => controller.abort();
    init.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await this.fetchImpl(`${this.base}${path}`, {
        method: init.method,
        headers: {
          authorization: `Bearer ${apiKey}`,
          accept: 'application/json',
          ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: controller.signal,
        redirect: 'error',
      });
      const raw = (await res.text()).slice(0, 16_384);
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        body = undefined;
      }
      const retryAfter = res.headers.get('retry-after');
      return { kind: 'response', status: res.status, body, ...(retryAfter ? { retryAfter } : {}) };
    } catch (error) {
      const code = errorCode(error);
      return code && NOT_SENT_CODES.has(code) ? { kind: 'not_sent' } : { kind: 'unknown' };
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', onAbort);
    }
  }

  private failure<T>(
    result:
      | { kind: 'not_sent' }
      | { kind: 'unknown' }
      | { kind: 'response'; status: number; body: unknown; retryAfter?: string },
  ): AIProviderResult<T> {
    if (result.kind === 'not_sent') return { outcome: 'ERROR', errorClass: 'PROVIDER_UNAVAILABLE' };
    if (result.kind === 'unknown') return { outcome: 'ERROR', errorClass: 'UNKNOWN_OUTCOME' };
    const error = (result.body as { error?: { code?: unknown; type?: unknown } } | undefined)?.error;
    // The provider's own code or type, never its message: an OpenAI-style message quotes the request.
    const providerCode = str(error?.code) ?? str(error?.type);
    const errorClass = classifyOpenAIStatus(result.status);
    const retryAfterSeconds =
      errorClass === 'RATE_LIMITED' && result.retryAfter && /^\d{1,6}$/u.test(result.retryAfter)
        ? Number(result.retryAfter)
        : undefined;
    return {
      outcome: 'ERROR',
      errorClass,
      ...(providerCode ? { providerCode } : {}),
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    };
  }

  async listModels(credential: AICredentialHandle): Promise<AIProviderResult<readonly AIModelDescriptor[]>> {
    const result = await credential.withKey((apiKey) => this.call('/models', apiKey, { method: 'GET' }));
    if (result.kind !== 'response' || result.status < 200 || result.status >= 300) {
      return this.failure(result);
    }
    const data = (result.body as { data?: unknown } | undefined)?.data;
    if (!Array.isArray(data)) {
      return { outcome: 'ERROR', errorClass: 'PROVIDER_ERROR', providerCode: 'UNEXPECTED_BODY' };
    }
    const capabilities = this.metadata(credential.declaredTier)?.capabilities ?? ['text'];
    const value: AIModelDescriptor[] = [];
    for (const entry of data as Array<{ id?: unknown }>) {
      const id = str(entry.id);
      if (!id) continue;
      value.push({
        modelId: id,
        // These APIs return no display name. Using the id is honest; inventing a prettier one would
        // put a label in the picker that matches nothing the provider recognises.
        displayName: id,
        capabilities: capabilities.filter(
          (capability): capability is 'text' | 'json_schema' =>
            capability === 'text' || capability === 'json_schema',
        ),
      });
    }
    return { outcome: 'OK', value };
  }

  /**
   * Validates a credential (AICRED-004).
   *
   * A model list, as with Gemini: the cheapest call that proves a key works, and it carries no prompt.
   *
   * No `tierSignal`. None of these providers reports account tier on a model list, and OpenRouter's
   * no-training status depends on an account setting this platform cannot read at all. A guessed
   * signal would either block a valid paid key or quietly treat a free key as paid, so the doctor's
   * declaration stands and the UI says the tier is self-declared.
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
      return { outcome: 'ERROR', errorClass: 'UNKNOWN_OUTCOME', providerCode: 'LEASE_LOST' };
    }
    if (input.jsonSchema && !this.supports(credential.declaredTier, 'json_schema')) {
      // Refused rather than sent hopefully. A provider that ignores `response_format` answers prose,
      // and the caller's parse failure would be blamed on the model rather than on the capability
      // claim that was never verified (register: JSON_SCHEMA_SUPPORT_UNVERIFIED).
      return {
        outcome: 'ERROR',
        errorClass: 'SCHEMA_INVALID',
        providerCode: 'JSON_SCHEMA_NOT_SUPPORTED',
      };
    }
    const body = {
      model: input.modelId,
      messages: [{ role: 'user', content: input.prompt }],
      ...(input.maxOutputTokens !== undefined ? { max_tokens: input.maxOutputTokens } : {}),
      ...(input.jsonSchema
        ? {
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'structured_output', strict: true, schema: input.jsonSchema },
            },
          }
        : {}),
    };
    const result = await credential.withKey((apiKey) =>
      this.call('/chat/completions', apiKey, {
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
          choices?: Array<{ finish_reason?: unknown; message?: { content?: unknown } }>;
          usage?: Record<string, unknown>;
        }
      | undefined;
    const choice = payload?.choices?.[0];
    const finishReason = str(choice?.finish_reason);
    if (finishReason === 'content_filter') {
      // The provider refused on its own policy grounds; a retry sends the same text.
      return { outcome: 'ERROR', errorClass: 'CONTENT_BLOCKED', providerCode: finishReason };
    }
    const text = (str(choice?.message?.content) ?? '').trim();
    if (text.length === 0) {
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
        return { outcome: 'ERROR', errorClass: 'SCHEMA_INVALID', providerCode: 'UNPARSEABLE_JSON' };
      }
    }
    return { outcome: 'OK', value: { text }, usage: usageOf(payload?.usage) };
  }
}

/** Provider-reported counts where present. Labelled an estimate wherever shown (AICRED-005). */
function usageOf(
  usage: Record<string, unknown> | undefined,
): { inputTokens?: number; outputTokens?: number } | undefined {
  if (!usage) return undefined;
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
  const inputTokens = num(usage.prompt_tokens);
  const outputTokens = num(usage.completion_tokens);
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
  };
}
