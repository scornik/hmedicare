import { describe, expect, it } from 'vitest';
import type { AICredentialHandle } from '@hmedic/ai';
import { GeminiApiAdapter, classifyGeminiStatus } from '../../src/index';
import {
  BAD_REQUEST_400,
  GENERATE_200,
  GENERATE_200_BAD_JSON,
  GENERATE_200_BLOCKED,
  GENERATE_200_EMPTY,
  GENERATE_200_JSON,
  GENERATE_200_SAFETY_FINISH,
  KEY_INVALID_400,
  MODELS_200,
  NOT_FOUND_404,
  PERMISSION_DENIED_403,
  RATE_LIMITED_429,
  RATE_LIMITED_429_NO_DELAY,
  SERVER_ERROR_503,
} from './fixtures';

/**
 * `GeminiApiAdapter` against recorded synthetic responses (ADAPT-003).
 *
 * No network: `fetch` is injected, as in the SMS adapter. What is asserted is the translation — the
 * key's route into the request, the mapping of every failure the port names, and the fact that
 * Google's own prose never reaches a result.
 */
const API_KEY = 'synthetic_gemini_key_0123456789';
const PROMPT = 'SYNTHETIC: summarise this consultation.';

interface Recorded {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body?: unknown;
}

function harness(responses: Array<{ status: number; body?: unknown; text?: string } | Error>): {
  adapter: GeminiApiAdapter;
  calls: Recorded[];
  credential: () => AICredentialHandle;
} {
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
    return new Response(next.text ?? JSON.stringify(next.body ?? {}), { status: next.status });
  }) as unknown as typeof globalThis.fetch;

  return {
    adapter: new GeminiApiAdapter({ baseUrl: 'https://gemini.test', fetch: fetchImpl }),
    calls,
    credential: () => ({
      credentialId: '01a13007-0000-7000-8000-000000000001',
      providerCode: 'gemini',
      declaredTier: 'FREE',
      withKey: (fn) => fn(API_KEY),
    }),
  };
}

const transport = (code: string) => Object.assign(new Error('fetch failed'), { cause: { code } });

describe('GeminiApiAdapter: requests', () => {
  it('sends the key in a header and never in the URL', async () => {
    const h = harness([{ status: 200, body: MODELS_200 }]);
    await h.adapter.listModels(h.credential());

    const call = h.calls[0]!;
    expect(call.headers['x-goog-api-key']).toBe(API_KEY);
    // Google's API accepts `?key=`, and using it would put the key in access logs, proxies and
    // history. BUILD-CONTRACT forbids a GET carrying a secret.
    expect(call.url).not.toContain(API_KEY);
    expect(call.url).toBe('https://gemini.test/v1beta/models?pageSize=200');
  });

  it('posts the prompt to the model’s generateContent path', async () => {
    const h = harness([{ status: 200, body: GENERATE_200 }]);
    await h.adapter.generate(h.credential(), { modelId: 'gemini-synthetic-pro', prompt: PROMPT });

    const call = h.calls[0]!;
    expect(call.url).toBe('https://gemini.test/v1beta/models/gemini-synthetic-pro:generateContent');
    expect(call.method).toBe('POST');
    expect(call.body).toMatchObject({
      contents: [{ role: 'user', parts: [{ text: PROMPT }] }],
    });
  });

  it('asks for JSON only when a schema was requested', async () => {
    const h = harness([{ status: 200, body: GENERATE_200_JSON }]);
    await h.adapter.generate(h.credential(), {
      modelId: 'gemini-synthetic-pro',
      prompt: PROMPT,
      jsonSchema: { type: 'object' },
      maxOutputTokens: 256,
    });
    expect(h.calls[0]!.body).toMatchObject({
      generationConfig: {
        maxOutputTokens: 256,
        responseMimeType: 'application/json',
        responseSchema: { type: 'object' },
      },
    });
  });
});

describe('GeminiApiAdapter: listModels', () => {
  it('returns only models that can answer a generate call', async () => {
    const h = harness([{ status: 200, body: MODELS_200 }]);
    const result = await h.adapter.listModels(h.credential());

    expect(result.outcome).toBe('OK');
    // The embedding model is dropped: offering it in a picker would offer a call that fails on use.
    expect(result.outcome === 'OK' && result.value.map((m) => m.modelId)).toEqual([
      'gemini-synthetic-pro',
      'gemini-synthetic-flash',
    ]);
    // The `models/` collection prefix is removed, since the id used in a request path is what belongs
    // in the catalog.
    expect(result.outcome === 'OK' && result.value[0]).toMatchObject({
      displayName: 'Gemini Synthetic Pro',
      capabilities: ['text', 'json_schema'],
    });
  });

  it('refuses a 200 whose body is not the documented shape', async () => {
    const h = harness([{ status: 200, body: { unexpected: true } }]);
    const result = await h.adapter.listModels(h.credential());
    expect(result.outcome === 'ERROR' && result.errorClass).toBe('PROVIDER_ERROR');
    expect(result.outcome === 'ERROR' && result.providerCode).toBe('UNEXPECTED_BODY');
  });

  it('refuses a 200 that is not JSON at all', async () => {
    const h = harness([{ status: 200, text: '<html>proxy error</html>' }]);
    const result = await h.adapter.listModels(h.credential());
    expect(result.outcome === 'ERROR' && result.errorClass).toBe('PROVIDER_ERROR');
  });
});

describe('GeminiApiAdapter: generate', () => {
  it('returns the text and the provider’s token counts', async () => {
    const h = harness([{ status: 200, body: GENERATE_200 }]);
    const result = await h.adapter.generate(h.credential(), {
      modelId: 'gemini-synthetic-pro',
      prompt: PROMPT,
    });

    expect(result.outcome === 'OK' && result.value.text).toBe('SYNTHETIC draft text.');
    expect(result.outcome === 'OK' && result.usage).toEqual({ inputTokens: 42, outputTokens: 7 });
  });

  it('reports a blocked prompt as CONTENT_BLOCKED', async () => {
    const h = harness([{ status: 200, body: GENERATE_200_BLOCKED }]);
    const result = await h.adapter.generate(h.credential(), {
      modelId: 'gemini-synthetic-pro',
      prompt: PROMPT,
    });
    // Google refused on its own policy grounds, and a retry would send the same text.
    expect(result.outcome === 'ERROR' && result.errorClass).toBe('CONTENT_BLOCKED');
    expect(result.outcome === 'ERROR' && result.providerCode).toBe('SAFETY');
  });

  it('reports a safety finish reason as CONTENT_BLOCKED', async () => {
    const h = harness([{ status: 200, body: GENERATE_200_SAFETY_FINISH }]);
    const result = await h.adapter.generate(h.credential(), {
      modelId: 'gemini-synthetic-pro',
      prompt: PROMPT,
    });
    expect(result.outcome === 'ERROR' && result.errorClass).toBe('CONTENT_BLOCKED');
  });

  it('reports an empty 200 as a provider error, not a success', async () => {
    const h = harness([{ status: 200, body: GENERATE_200_EMPTY }]);
    const result = await h.adapter.generate(h.credential(), {
      modelId: 'gemini-synthetic-pro',
      prompt: PROMPT,
    });
    // Neither a refusal nor an answer. Returning empty text as OK would put a blank draft in front of
    // a doctor as though the model had written it.
    expect(result.outcome === 'ERROR' && result.errorClass).toBe('PROVIDER_ERROR');
    expect(result.outcome === 'ERROR' && result.providerCode).toBe('MAX_TOKENS');
  });

  it('reports unparseable JSON as SCHEMA_INVALID when a schema was requested', async () => {
    const h = harness([{ status: 200, body: GENERATE_200_BAD_JSON }]);
    const result = await h.adapter.generate(h.credential(), {
      modelId: 'gemini-synthetic-pro',
      prompt: PROMPT,
      jsonSchema: { type: 'object' },
    });
    expect(result.outcome === 'ERROR' && result.errorClass).toBe('SCHEMA_INVALID');
  });

  it('accepts prose when no schema was requested', async () => {
    const h = harness([{ status: 200, body: GENERATE_200_BAD_JSON }]);
    const result = await h.adapter.generate(h.credential(), {
      modelId: 'gemini-synthetic-pro',
      prompt: PROMPT,
    });
    expect(result.outcome).toBe('OK');
  });

  it('sends nothing once the lease is lost', async () => {
    const h = harness([{ status: 200, body: GENERATE_200 }]);
    const result = await h.adapter.generate(h.credential(), {
      modelId: 'gemini-synthetic-pro',
      prompt: PROMPT,
      signal: AbortSignal.abort(),
    });
    expect(result.outcome === 'ERROR' && result.errorClass).toBe('UNKNOWN_OUTCOME');
    expect(h.calls).toHaveLength(0);
  });
});

describe('GeminiApiAdapter: error mapping', () => {
  it('maps a rejected key to INVALID_CREDENTIAL from the structured reason', async () => {
    const h = harness([{ status: 400, body: KEY_INVALID_400 }]);
    const result = await h.adapter.listModels(h.credential());

    // 400 INVALID_ARGUMENT covers both a bad key and a bad request; only the ErrorInfo reason
    // separates them.
    expect(result.outcome === 'ERROR' && result.errorClass).toBe('INVALID_CREDENTIAL');
    expect(result.outcome === 'ERROR' && result.providerCode).toBe('API_KEY_INVALID');
  });

  it('maps a malformed request to PROVIDER_ERROR, not to the doctor’s key', async () => {
    const h = harness([{ status: 400, body: BAD_REQUEST_400 }]);
    const result = await h.adapter.listModels(h.credential());
    // Blaming the credential for this adapter's own bad request would send a doctor to re-enter a key
    // that was never the problem.
    expect(result.outcome === 'ERROR' && result.errorClass).toBe('PROVIDER_ERROR');
  });

  it.each([
    [403, PERMISSION_DENIED_403, 'INVALID_CREDENTIAL'],
    [404, NOT_FOUND_404, 'MODEL_UNAVAILABLE'],
    [429, RATE_LIMITED_429, 'RATE_LIMITED'],
    [503, SERVER_ERROR_503, 'UNKNOWN_OUTCOME'],
  ])('maps %i to %s', async (status, body, errorClass) => {
    const h = harness([{ status, body }]);
    const result = await h.adapter.generate(h.credential(), {
      modelId: 'gemini-synthetic-pro',
      prompt: PROMPT,
    });
    expect(result.outcome === 'ERROR' && result.errorClass).toBe(errorClass);
  });

  it('reads the retry delay Google supplied', async () => {
    const h = harness([{ status: 429, body: RATE_LIMITED_429 }]);
    const result = await h.adapter.generate(h.credential(), {
      modelId: 'gemini-synthetic-pro',
      prompt: PROMPT,
    });
    expect(result.outcome === 'ERROR' && result.retryAfterSeconds).toBe(17);
  });

  it('omits the delay when Google named none', async () => {
    const h = harness([{ status: 429, body: RATE_LIMITED_429_NO_DELAY }]);
    const result = await h.adapter.generate(h.credential(), {
      modelId: 'gemini-synthetic-pro',
      prompt: PROMPT,
    });
    // The caller then uses its own default rather than a delay nobody stated.
    expect(result.outcome === 'ERROR' && result.retryAfterSeconds).toBeUndefined();
  });

  it.each(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'])(
    'reports %s as PROVIDER_UNAVAILABLE, which is safe to retry',
    async (code) => {
      const h = harness([transport(code)]);
      const result = await h.adapter.generate(h.credential(), {
        modelId: 'gemini-synthetic-pro',
        prompt: PROMPT,
      });
      // Provably never sent: a connect or DNS failure happens before any request bytes go out.
      expect(result.outcome === 'ERROR' && result.errorClass).toBe('PROVIDER_UNAVAILABLE');
    },
  );

  it('reports a timeout after sending as UNKNOWN_OUTCOME', async () => {
    const h = harness([Object.assign(new Error('aborted'), { name: 'AbortError' })]);
    const result = await h.adapter.generate(h.credential(), {
      modelId: 'gemini-synthetic-pro',
      prompt: PROMPT,
    });
    // The model may well have run. Treating this as retryable is how a job gets executed twice.
    expect(result.outcome === 'ERROR' && result.errorClass).toBe('UNKNOWN_OUTCOME');
  });

  it('never carries Google’s message into a result', async () => {
    const h = harness([{ status: 400, body: KEY_INVALID_400 }]);
    const result = await h.adapter.generate(h.credential(), {
      modelId: 'gemini-synthetic-pro',
      prompt: PROMPT,
    });
    // An error message can quote the prompt that caused it, so only the status and reason enums are
    // kept.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('Please pass a valid API key');
    expect(serialized).not.toContain(API_KEY);
    expect(serialized).not.toContain(PROMPT);
  });

  it('classifies statuses without a body', () => {
    expect(classifyGeminiStatus(401)).toBe('INVALID_CREDENTIAL');
    expect(classifyGeminiStatus(400)).toBe('PROVIDER_ERROR');
    expect(classifyGeminiStatus(418)).toBe('PROVIDER_ERROR');
    expect(classifyGeminiStatus(500)).toBe('UNKNOWN_OUTCOME');
  });
});

describe('GeminiApiAdapter: validate', () => {
  it('proves the key works with a call that carries no prompt', async () => {
    const h = harness([{ status: 200, body: MODELS_200 }]);
    const result = await h.adapter.validate(h.credential());

    expect(result.outcome).toBe('OK');
    // A GET model list, with no body: validation happens before anyone has decided this credential may
    // see patient data, so it must not be able to send any.
    expect(h.calls[0]!.method).toBe('GET');
    expect(h.calls[0]!.body).toBeUndefined();
  });

  it('reports no tier signal, because the API exposes none', async () => {
    const h = harness([{ status: 200, body: MODELS_200 }]);
    const result = await h.adapter.validate(h.credential());
    // Re-checked 2026-10-13 for ADAPT-003: the models response carries no billing or tier field, and
    // no other endpoint reports account tier. The declaration therefore stands, and the UI says the
    // tier is self-declared. A guessed signal would either block a valid paid key or treat a free key
    // as paid.
    expect(result.outcome === 'OK' && result.value.tierSignal).toBeUndefined();
  });

  it('passes a rejected key through as INVALID_CREDENTIAL', async () => {
    const h = harness([{ status: 400, body: KEY_INVALID_400 }]);
    const result = await h.adapter.validate(h.credential());
    expect(result.outcome === 'ERROR' && result.errorClass).toBe('INVALID_CREDENTIAL');
  });
});
