/**
 * Recorded synthetic Gemini responses (ADAPT-003).
 *
 * Shapes are taken from Google's published API documentation and trimmed to the fields this adapter
 * reads. They are written by hand rather than captured from a live account, so there is no chance of a
 * real key, a real prompt or a real patient's text ending up in a fixture — and nothing here reaches
 * the network when the tests run.
 */
export const MODELS_200 = {
  models: [
    {
      name: 'models/gemini-synthetic-pro',
      displayName: 'Gemini Synthetic Pro',
      version: '001',
      inputTokenLimit: 1_048_576,
      outputTokenLimit: 8192,
      supportedGenerationMethods: ['generateContent', 'countTokens'],
    },
    {
      name: 'models/gemini-synthetic-flash',
      displayName: 'Gemini Synthetic Flash',
      version: '001',
      supportedGenerationMethods: ['generateContent'],
    },
    {
      // Embedding-only: it cannot answer a generate call, so a picker must not offer it.
      name: 'models/text-embedding-synthetic',
      displayName: 'Synthetic Embedding',
      supportedGenerationMethods: ['embedContent'],
    },
  ],
};

export const GENERATE_200 = {
  candidates: [
    {
      content: { role: 'model', parts: [{ text: 'SYNTHETIC draft text.' }] },
      finishReason: 'STOP',
    },
  ],
  usageMetadata: { promptTokenCount: 42, candidatesTokenCount: 7, totalTokenCount: 49 },
};

export const GENERATE_200_JSON = {
  candidates: [
    {
      content: { role: 'model', parts: [{ text: '{"synthetic":true}' }] },
      finishReason: 'STOP',
    },
  ],
};

/** A 200 whose text is not JSON although a schema was requested. */
export const GENERATE_200_BAD_JSON = {
  candidates: [
    { content: { role: 'model', parts: [{ text: 'Sorry, here is prose instead.' }] }, finishReason: 'STOP' },
  ],
};

export const GENERATE_200_BLOCKED = {
  promptFeedback: { blockReason: 'SAFETY' },
};

export const GENERATE_200_SAFETY_FINISH = {
  candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'SAFETY' }],
};

export const GENERATE_200_EMPTY = {
  candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'MAX_TOKENS' }],
};

/**
 * 400 for a key Google rejects.
 *
 * The `message` here is deliberately included in the fixture although the adapter never keeps it: the
 * test asserts that it does not appear in the result, which only means something if the fixture has
 * one.
 */
export const KEY_INVALID_400 = {
  error: {
    code: 400,
    message: 'API key not valid. Please pass a valid API key.',
    status: 'INVALID_ARGUMENT',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
        reason: 'API_KEY_INVALID',
        domain: 'googleapis.com',
      },
    ],
  },
};

/** 400 for a request this adapter built wrong. Same status, no key reason. */
export const BAD_REQUEST_400 = {
  error: {
    code: 400,
    message: 'Invalid JSON payload received. Unknown name "contnets".',
    status: 'INVALID_ARGUMENT',
  },
};

export const PERMISSION_DENIED_403 = {
  error: { code: 403, message: 'Permission denied on resource.', status: 'PERMISSION_DENIED' },
};

export const NOT_FOUND_404 = {
  error: {
    code: 404,
    message: 'models/gemini-absent is not found for API version v1beta.',
    status: 'NOT_FOUND',
  },
};

export const RATE_LIMITED_429 = {
  error: {
    code: 429,
    message: 'Resource has been exhausted (e.g. check quota).',
    status: 'RESOURCE_EXHAUSTED',
    details: [
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '17s' },
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'synthetic' }] },
    ],
  },
};

export const RATE_LIMITED_429_NO_DELAY = {
  error: { code: 429, message: 'Quota exceeded.', status: 'RESOURCE_EXHAUSTED' },
};

export const SERVER_ERROR_503 = {
  error: { code: 503, message: 'The model is overloaded. Please try again later.', status: 'UNAVAILABLE' },
};
