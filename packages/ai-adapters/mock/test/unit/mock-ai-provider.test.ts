import { describe, expect, it } from 'vitest';
import {
  AI_CREDENTIAL_FAULTS,
  AI_SAFE_TO_RETRY,
  type AICredentialHandle,
  type AIErrorClass,
} from '@hmedic/ai';
import { MOCK_MODELS, type MockAIScenario, MockAIProvider } from '../../src/index';

/**
 * The mock AI provider (ADAPT-001).
 *
 * Two things are worth asserting about a fake. That it can produce every failure the taxonomy names,
 * because a caller's behaviour is chosen by the error class and an untestable class is an untested
 * branch. And that it never keeps the prompt, because a fixture holding clinical text becomes a place
 * patient data collects in CI output.
 */
let opened = 0;
const credential = (): AICredentialHandle => ({
  credentialId: '01a13007-0000-7000-8000-000000000001',
  providerCode: 'mock',
  declaredTier: 'FREE',
  withKey: async (fn) => {
    opened += 1;
    return fn('synthetic_mock_key_0123456789');
  },
});

const PROMPT = 'SYNTHETIC: patient reports a cough for one week.';

describe('mock AI provider', () => {
  it('generates deterministic, obviously synthetic text', async () => {
    const provider = new MockAIProvider();
    const first = await provider.generate(credential(), { modelId: 'mock-text-1', prompt: PROMPT });
    const second = await provider.generate(credential(), { modelId: 'mock-text-1', prompt: PROMPT });

    expect(first.outcome).toBe('OK');
    expect(first).toEqual(second);
    // Output that read like real clinical prose would eventually be mistaken for it in a screenshot.
    expect(first.outcome === 'OK' && first.value.text).toContain('SYNTHETIC');
  });

  it('returns JSON when a schema is requested', async () => {
    const provider = new MockAIProvider();
    const result = await provider.generate(credential(), {
      modelId: 'mock-text-1',
      prompt: PROMPT,
      jsonSchema: { type: 'object' },
    });
    expect(result.outcome).toBe('OK');
    expect(result.outcome === 'OK' && JSON.parse(result.value.text)).toMatchObject({ synthetic: true });
  });

  it('records the call without keeping the prompt', async () => {
    const provider = new MockAIProvider();
    await provider.generate(credential(), { modelId: 'mock-text-1', prompt: PROMPT });

    const call = provider.calls[0]!;
    expect(call).toMatchObject({ method: 'generate', modelId: 'mock-text-1', schemaRequested: false });
    expect(call.promptLength).toBe(PROMPT.length);
    // The text itself is nowhere in the record.
    expect(JSON.stringify(provider.calls)).not.toContain('cough');
  });

  it.each([
    ['invalid_credential', 'INVALID_CREDENTIAL'],
    ['rate_limited', 'RATE_LIMITED'],
    ['quota_exhausted', 'QUOTA_EXHAUSTED'],
    ['tier_mismatch', 'TIER_MISMATCH'],
    ['content_blocked', 'CONTENT_BLOCKED'],
    ['schema_invalid', 'SCHEMA_INVALID'],
    ['provider_error', 'PROVIDER_ERROR'],
    ['provider_unavailable', 'PROVIDER_UNAVAILABLE'],
    ['unknown_outcome', 'UNKNOWN_OUTCOME'],
  ] as [MockAIScenario, AIErrorClass][])('produces %s on demand', async (scenario, errorClass) => {
    const provider = new MockAIProvider();
    provider.enqueue(scenario);
    const result = await provider.generate(credential(), { modelId: 'mock-text-1', prompt: PROMPT });

    expect(result.outcome).toBe('ERROR');
    expect(result.outcome === 'ERROR' && result.errorClass).toBe(errorClass);
  });

  it('reports a retry delay only for a rate limit', async () => {
    const provider = new MockAIProvider();
    provider.enqueue('rate_limited', 'quota_exhausted');

    const limited = await provider.generate(credential(), { modelId: 'mock-text-1', prompt: PROMPT });
    const spent = await provider.generate(credential(), { modelId: 'mock-text-1', prompt: PROMPT });

    expect(limited.outcome === 'ERROR' && limited.retryAfterSeconds).toBe(30);
    // An exhausted quota carries no delay, because no wait inside one job clears it, and a caller
    // must not learn a delay from a class that does not have one.
    expect(spent.outcome === 'ERROR' && spent.retryAfterSeconds).toBeUndefined();
  });

  it('refuses a model it does not list, whatever the scenario', async () => {
    const provider = new MockAIProvider();
    const result = await provider.generate(credential(), { modelId: 'not-a-model', prompt: PROMPT });
    expect(result.outcome === 'ERROR' && result.errorClass).toBe('MODEL_UNAVAILABLE');
  });

  it('answers UNKNOWN_OUTCOME when the lease was lost mid-call', async () => {
    const provider = new MockAIProvider();
    const aborted = AbortSignal.abort();
    const result = await provider.generate(credential(), {
      modelId: 'mock-text-1',
      prompt: PROMPT,
      signal: aborted,
    });
    // Not "unavailable": the runner cannot tell whether the provider had already begun.
    expect(result.outcome === 'ERROR' && result.errorClass).toBe('UNKNOWN_OUTCOME');
  });

  it('opens the credential even on a failure path', async () => {
    const provider = new MockAIProvider();
    opened = 0;
    provider.enqueue('invalid_credential');
    await provider.generate(credential(), { modelId: 'mock-text-1', prompt: PROMPT });
    // A provider would have sent the key before failing; a mock that skipped it would hide a
    // credential that was never opened at all.
    expect(opened).toBe(1);
  });

  it('lists models and validates without a tier signal by default', async () => {
    const provider = new MockAIProvider();
    const models = await provider.listModels(credential());
    expect(models.outcome === 'OK' && models.value).toEqual(MOCK_MODELS);

    const validated = await provider.validate(credential());
    // No reliable signal is the honest default (ADR-017 §3): the declaration stands.
    expect(validated.outcome === 'OK' && validated.value.tierSignal).toBeUndefined();
  });

  it('reports a tier signal when one is set, so TIER_MISMATCH can be exercised', async () => {
    const provider = new MockAIProvider();
    provider.tierSignal = 'PAID';
    const validated = await provider.validate(credential());
    expect(validated.outcome === 'OK' && validated.value.tierSignal).toBe('PAID');
  });

  it('queues scenarios in order, then falls back to the default', async () => {
    const provider = new MockAIProvider();
    provider.defaultScenario = 'provider_error';
    provider.enqueue('success', 'quota_exhausted');

    const results = [
      await provider.validate(credential()),
      await provider.validate(credential()),
      await provider.validate(credential()),
    ];
    expect(results.map((r) => r.outcome)).toEqual(['OK', 'ERROR', 'ERROR']);
    expect(results[1]!.outcome === 'ERROR' && results[1]!.errorClass).toBe('QUOTA_EXHAUSTED');
    expect(results[2]!.outcome === 'ERROR' && results[2]!.errorClass).toBe('PROVIDER_ERROR');
  });

  it('classifies retry safety and credential faults consistently', () => {
    // These two lists are what callers branch on, so they must not overlap: a class cannot be both
    // "safe to retry unchanged" and "the credential is the problem".
    for (const cls of AI_SAFE_TO_RETRY) expect(AI_CREDENTIAL_FAULTS).not.toContain(cls);
    expect(AI_SAFE_TO_RETRY).toContain('PROVIDER_UNAVAILABLE');
    // A rate limit is a refusal to start, so retrying the same request is safe; an exhausted quota
    // describes the account and belongs with the credential faults.
    expect(AI_SAFE_TO_RETRY).toContain('RATE_LIMITED');
    expect(AI_CREDENTIAL_FAULTS).toContain('INVALID_CREDENTIAL');
    expect(AI_CREDENTIAL_FAULTS).toContain('QUOTA_EXHAUSTED');
    // Deliberately absent from both: nobody may assume an unknown outcome did not happen.
    expect(AI_SAFE_TO_RETRY).not.toContain('UNKNOWN_OUTCOME');
    expect(AI_CREDENTIAL_FAULTS).not.toContain('UNKNOWN_OUTCOME');
  });
});
