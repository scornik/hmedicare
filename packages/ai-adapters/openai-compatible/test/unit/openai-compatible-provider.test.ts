import { describe, expect, it } from 'vitest';
import type { AICredentialHandle, DeclaredTier } from '@hmedic/ai';
import {
  OPENAI_COMPATIBLE_PROFILES,
  OpenAICompatibleAdapter,
  type OpenAICompatibleProviderCode,
  classifyOpenAIStatus,
} from '../../src/index';

/**
 * `OpenAICompatibleAdapter` against recorded synthetic responses (ADAPT-004).
 *
 * No network: `fetch` is injected. The shapes below follow the published chat-completions and models
 * responses, trimmed to the fields this adapter reads, and are written by hand so no real key, prompt
 * or patient text can reach a fixture.
 */
const API_KEY = 'synthetic_openai_key_0123456789';
const PROMPT = 'SYNTHETIC: summarise this consultation.';

const MODELS_200 = {
  object: 'list',
  data: [
    { id: 'synthetic-small', object: 'model', owned_by: 'synthetic' },
    { id: 'synthetic-large', object: 'model', owned_by: 'synthetic' },
  ],
};
const CHAT_200 = {
  choices: [
    { index: 0, message: { role: 'assistant', content: 'SYNTHETIC draft text.' }, finish_reason: 'stop' },
  ],
  usage: { prompt_tokens: 31, completion_tokens: 9, total_tokens: 40 },
};
const CHAT_200_JSON = {
  choices: [{ message: { role: 'assistant', content: '{"synthetic":true}' }, finish_reason: 'stop' }],
};
const CHAT_200_PROSE = {
  choices: [{ message: { role: 'assistant', content: 'Prose, not JSON.' }, finish_reason: 'stop' }],
};
const CHAT_200_FILTERED = {
  choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'content_filter' }],
};
const CHAT_200_EMPTY = {
  choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'length' }],
};
const UNAUTHORIZED_401 = {
  error: {
    message: 'Incorrect API key provided: sk-sy****. You can find your API key at …',
    type: 'invalid_request_error',
    code: 'invalid_api_key',
  },
};
const NOT_FOUND_404 = {
  error: {
    message: 'The model `synthetic-absent` does not exist.',
    type: 'invalid_request_error',
    code: 'model_not_found',
  },
};
const RATE_LIMITED_429 = {
  error: {
    message: 'Rate limit reached for synthetic-small.',
    type: 'requests',
    code: 'rate_limit_exceeded',
  },
};
const SERVER_ERROR_500 = {
  error: { message: 'The server had an error processing your request.', type: 'server_error' },
};

interface Recorded {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body?: unknown;
}

function harness(
  responses: Array<{ status: number; body?: unknown; text?: string; retryAfter?: string } | Error>,
  providerCode: OpenAICompatibleProviderCode = 'openai',
  tier: DeclaredTier = 'PAID',
) {
  const calls: Recorded[] = [];
  let index = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[key.toLowerCase()] = value;
    }
    calls.push({
      url: String(url),
      ...(init?.method ? { method: init.method } : {}),
      headers,
      ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) } : {}),
    });
    const next = responses[Math.min(index++, responses.length - 1)]!;
    if (next instanceof Error) throw next;
    return new Response(next.text ?? JSON.stringify(next.body ?? {}), {
      status: next.status,
      ...(next.retryAfter ? { headers: { 'retry-after': next.retryAfter } } : {}),
    });
  }) as unknown as typeof globalThis.fetch;

  return {
    adapter: new OpenAICompatibleAdapter({
      providerCode,
      baseUrl: 'https://provider.test/v1',
      fetch: fetchImpl,
    }),
    calls,
    credential: (): AICredentialHandle => ({
      credentialId: '01a13007-0000-7000-8000-000000000001',
      providerCode,
      declaredTier: tier,
      withKey: (fn) => fn(API_KEY),
    }),
  };
}

const transport = (code: string) => Object.assign(new Error('fetch failed'), { cause: { code } });

describe('OpenAICompatibleAdapter: construction and metadata', () => {
  it('serves one provider code per instance', () => {
    const adapter = new OpenAICompatibleAdapter({ providerCode: 'groq' });
    // One instance for several codes would make `metadata(tier)` ambiguous, and the register keys
    // adapters by code.
    expect(adapter.providerCode).toBe('groq');
    expect(adapter.metadata('FREE')?.providerCode).toBe('groq');
  });

  it('refuses a provider it has no register row for', () => {
    expect(
      () => new OpenAICompatibleAdapter({ providerCode: 'anthropic' as OpenAICompatibleProviderCode }),
    ).toThrow(/no OpenAI-compatible register row for anthropic/);
  });

  it('defaults to the base URL in the register row', () => {
    expect(OPENAI_COMPATIBLE_PROFILES.groq.baseUrl).toBe('https://api.groq.com/openai/v1');
    expect(OPENAI_COMPATIBLE_PROFILES.deepseek.baseUrl).toBe('https://api.deepseek.com');
  });

  it('answers null for a tier the register does not cover', () => {
    // OpenAI has a PAID row only. Null is the refusal the credential store acts on; a default would be
    // a classification nobody reviewed.
    const adapter = new OpenAICompatibleAdapter({ providerCode: 'openai' });
    expect(adapter.metadata('PAID')).not.toBeNull();
    expect(adapter.metadata('FREE')).toBeNull();
  });
});

describe('OpenAICompatibleAdapter: requests', () => {
  it('sends the key as a bearer token, never in the URL', async () => {
    const h = harness([{ status: 200, body: MODELS_200 }]);
    await h.adapter.listModels(h.credential());

    expect(h.calls[0]!.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(h.calls[0]!.url).toBe('https://provider.test/v1/models');
    expect(h.calls[0]!.url).not.toContain(API_KEY);
  });

  it('posts a chat completion with the model in the body', async () => {
    const h = harness([{ status: 200, body: CHAT_200 }]);
    await h.adapter.generate(h.credential(), { modelId: 'synthetic-small', prompt: PROMPT });

    expect(h.calls[0]!.url).toBe('https://provider.test/v1/chat/completions');
    expect(h.calls[0]!.body).toMatchObject({
      model: 'synthetic-small',
      messages: [{ role: 'user', content: PROMPT }],
    });
  });

  it('asks for a strict schema where the provider claims support', async () => {
    const h = harness([{ status: 200, body: CHAT_200_JSON }]);
    await h.adapter.generate(h.credential(), {
      modelId: 'synthetic-small',
      prompt: PROMPT,
      jsonSchema: { type: 'object' },
      maxOutputTokens: 128,
    });
    expect(h.calls[0]!.body).toMatchObject({
      max_tokens: 128,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'structured_output', strict: true, schema: { type: 'object' } },
      },
    });
  });

  it('refuses a schema request for a provider whose support is unverified', async () => {
    const h = harness([{ status: 200, body: CHAT_200_JSON }], 'groq', 'FREE');
    const result = await h.adapter.generate(h.credential(), {
      modelId: 'synthetic-small',
      prompt: PROMPT,
      jsonSchema: { type: 'object' },
    });

    // Refused, not sent hopefully: a provider that ignores `response_format` answers prose, and the
    // caller's parse failure would be blamed on the model rather than on the unverified claim.
    expect(result.outcome === 'ERROR' && result.errorClass).toBe('SCHEMA_INVALID');
    expect(result.outcome === 'ERROR' && result.providerCode).toBe('JSON_SCHEMA_NOT_SUPPORTED');
    expect(h.calls).toHaveLength(0);
  });

  it('still sends plain text to that provider', async () => {
    const h = harness([{ status: 200, body: CHAT_200 }], 'groq', 'FREE');
    const result = await h.adapter.generate(h.credential(), {
      modelId: 'synthetic-small',
      prompt: PROMPT,
    });
    expect(result.outcome).toBe('OK');
    expect(h.calls[0]!.body).not.toHaveProperty('response_format');
  });
});

describe('OpenAICompatibleAdapter: responses', () => {
  it('returns the text and the provider’s token counts', async () => {
    const h = harness([{ status: 200, body: CHAT_200 }]);
    const result = await h.adapter.generate(h.credential(), {
      modelId: 'synthetic-small',
      prompt: PROMPT,
    });
    expect(result.outcome === 'OK' && result.value.text).toBe('SYNTHETIC draft text.');
    expect(result.outcome === 'OK' && result.usage).toEqual({ inputTokens: 31, outputTokens: 9 });
  });

  it('lists model ids as the provider gave them', async () => {
    const h = harness([{ status: 200, body: MODELS_200 }]);
    const result = await h.adapter.listModels(h.credential());
    expect(result.outcome === 'OK' && result.value.map((m) => m.modelId)).toEqual([
      'synthetic-small',
      'synthetic-large',
    ]);
    // These APIs return no display name. Inventing a prettier one would put a label in the picker that
    // matches nothing the provider recognises.
    expect(result.outcome === 'OK' && result.value[0]!.displayName).toBe('synthetic-small');
  });

  it('reports only the capabilities the register claims for the tier', async () => {
    const h = harness([{ status: 200, body: MODELS_200 }], 'groq', 'FREE');
    const result = await h.adapter.listModels(h.credential());
    expect(result.outcome === 'OK' && result.value[0]!.capabilities).toEqual(['text']);
  });

  it('reports a content filter as CONTENT_BLOCKED', async () => {
    const h = harness([{ status: 200, body: CHAT_200_FILTERED }]);
    const result = await h.adapter.generate(h.credential(), {
      modelId: 'synthetic-small',
      prompt: PROMPT,
    });
    expect(result.outcome === 'ERROR' && result.errorClass).toBe('CONTENT_BLOCKED');
  });

  it('reports an empty answer as a provider error, not a success', async () => {
    const h = harness([{ status: 200, body: CHAT_200_EMPTY }]);
    const result = await h.adapter.generate(h.credential(), {
      modelId: 'synthetic-small',
      prompt: PROMPT,
    });
    // Returning empty text as OK would put a blank draft in front of a doctor as the model's work.
    expect(result.outcome === 'ERROR' && result.errorClass).toBe('PROVIDER_ERROR');
    expect(result.outcome === 'ERROR' && result.providerCode).toBe('length');
  });

  it('reports prose where JSON was requested as SCHEMA_INVALID', async () => {
    const h = harness([{ status: 200, body: CHAT_200_PROSE }]);
    const result = await h.adapter.generate(h.credential(), {
      modelId: 'synthetic-small',
      prompt: PROMPT,
      jsonSchema: { type: 'object' },
    });
    expect(result.outcome === 'ERROR' && result.errorClass).toBe('SCHEMA_INVALID');
  });

  it('refuses a models 200 that is not the documented shape', async () => {
    const h = harness([{ status: 200, body: { object: 'list' } }]);
    const result = await h.adapter.listModels(h.credential());
    expect(result.outcome === 'ERROR' && result.providerCode).toBe('UNEXPECTED_BODY');
  });
});

describe('OpenAICompatibleAdapter: error mapping', () => {
  it.each([
    [401, UNAUTHORIZED_401, 'INVALID_CREDENTIAL', 'invalid_api_key'],
    [404, NOT_FOUND_404, 'MODEL_UNAVAILABLE', 'model_not_found'],
    [429, RATE_LIMITED_429, 'RATE_LIMITED', 'rate_limit_exceeded'],
    [500, SERVER_ERROR_500, 'UNKNOWN_OUTCOME', 'server_error'],
  ])('maps %i to %s', async (status, body, errorClass, providerCode) => {
    const h = harness([{ status, body }]);
    const result = await h.adapter.generate(h.credential(), {
      modelId: 'synthetic-small',
      prompt: PROMPT,
    });
    expect(result.outcome === 'ERROR' && result.errorClass).toBe(errorClass);
    expect(result.outcome === 'ERROR' && result.providerCode).toBe(providerCode);
  });

  it('reads the Retry-After header on a rate limit', async () => {
    const h = harness([{ status: 429, body: RATE_LIMITED_429, retryAfter: '23' }]);
    const result = await h.adapter.generate(h.credential(), {
      modelId: 'synthetic-small',
      prompt: PROMPT,
    });
    expect(result.outcome === 'ERROR' && result.retryAfterSeconds).toBe(23);
  });

  it('ignores a Retry-After this adapter cannot read as seconds', async () => {
    const h = harness([{ status: 429, body: RATE_LIMITED_429, retryAfter: 'Wed, 21 Oct 2026 07:28:00 GMT' }]);
    const result = await h.adapter.generate(h.credential(), {
      modelId: 'synthetic-small',
      prompt: PROMPT,
    });
    // The caller then uses its own default rather than a delay parsed wrongly.
    expect(result.outcome === 'ERROR' && result.retryAfterSeconds).toBeUndefined();
  });

  it.each(['ECONNREFUSED', 'ENOTFOUND'])('reports %s as PROVIDER_UNAVAILABLE', async (code) => {
    const h = harness([transport(code)]);
    const result = await h.adapter.generate(h.credential(), {
      modelId: 'synthetic-small',
      prompt: PROMPT,
    });
    expect(result.outcome === 'ERROR' && result.errorClass).toBe('PROVIDER_UNAVAILABLE');
  });

  it('reports a timeout after sending as UNKNOWN_OUTCOME', async () => {
    const h = harness([Object.assign(new Error('aborted'), { name: 'AbortError' })]);
    const result = await h.adapter.generate(h.credential(), {
      modelId: 'synthetic-small',
      prompt: PROMPT,
    });
    expect(result.outcome === 'ERROR' && result.errorClass).toBe('UNKNOWN_OUTCOME');
  });

  it('sends nothing once the lease is lost', async () => {
    const h = harness([{ status: 200, body: CHAT_200 }]);
    const result = await h.adapter.generate(h.credential(), {
      modelId: 'synthetic-small',
      prompt: PROMPT,
      signal: AbortSignal.abort(),
    });
    expect(result.outcome === 'ERROR' && result.errorClass).toBe('UNKNOWN_OUTCOME');
    expect(h.calls).toHaveLength(0);
  });

  it('never carries the provider’s message into a result', async () => {
    const h = harness([{ status: 401, body: UNAUTHORIZED_401 }]);
    const result = await h.adapter.generate(h.credential(), {
      modelId: 'synthetic-small',
      prompt: PROMPT,
    });
    const serialized = JSON.stringify(result);
    // An OpenAI-style message quotes the request, and this one quotes part of the key.
    expect(serialized).not.toContain('Incorrect API key provided');
    expect(serialized).not.toContain(API_KEY);
    expect(serialized).not.toContain(PROMPT);
  });

  it('classifies statuses on their own', () => {
    expect(classifyOpenAIStatus(403)).toBe('INVALID_CREDENTIAL');
    expect(classifyOpenAIStatus(400)).toBe('PROVIDER_ERROR');
    expect(classifyOpenAIStatus(503)).toBe('UNKNOWN_OUTCOME');
  });
});

describe('OpenAICompatibleAdapter: validate', () => {
  it('proves the key works with a call that carries no prompt', async () => {
    const h = harness([{ status: 200, body: MODELS_200 }]);
    const result = await h.adapter.validate(h.credential());
    expect(result.outcome).toBe('OK');
    expect(h.calls[0]!.method).toBe('GET');
    expect(h.calls[0]!.body).toBeUndefined();
  });

  it('reports no tier signal', async () => {
    const h = harness([{ status: 200, body: MODELS_200 }]);
    const result = await h.adapter.validate(h.credential());
    // None of these providers reports account tier on a model list, and OpenRouter's no-training
    // status depends on an account setting this platform cannot read at all.
    expect(result.outcome === 'OK' && result.value.tierSignal).toBeUndefined();
  });

  it('passes a rejected key through as INVALID_CREDENTIAL', async () => {
    const h = harness([{ status: 401, body: UNAUTHORIZED_401 }]);
    const result = await h.adapter.validate(h.credential());
    expect(result.outcome === 'ERROR' && result.errorClass).toBe('INVALID_CREDENTIAL');
  });
});
