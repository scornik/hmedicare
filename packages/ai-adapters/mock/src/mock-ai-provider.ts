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
import { MOCK_PROVIDER_CODE, mockMetadata } from './metadata';

/**
 * Deterministic mock AI provider (ADAPT-001).
 *
 * Exists so the policy engine, the validation job, the draft review flow and the error taxonomy can be
 * exercised end to end without a vendor, a key or a network. It sends nothing anywhere: every answer is
 * computed from the input.
 *
 * Scenarios are queued rather than randomised. A test that asserts "a quota refusal reschedules" has to
 * be able to produce a quota refusal on demand, and a provider that failed at random would make the
 * suite flaky in exactly the places where correctness matters most.
 *
 * It records what it was asked, but never the prompt: a fixture that keeps clinical text would become a
 * place patient data accumulates in test output and CI logs. Length and a hash are enough to assert
 * that minimization ran and that the same input produced the same request.
 */
export type MockAIScenario =
  | 'success'
  | 'invalid_credential'
  | 'rate_limited'
  | 'quota_exhausted'
  | 'tier_mismatch'
  | 'model_unavailable'
  | 'content_blocked'
  | 'schema_invalid'
  | 'provider_error'
  | 'provider_unavailable'
  | 'unknown_outcome';

const ERROR_FOR: Partial<Record<MockAIScenario, AIErrorClass>> = {
  invalid_credential: 'INVALID_CREDENTIAL',
  rate_limited: 'RATE_LIMITED',
  quota_exhausted: 'QUOTA_EXHAUSTED',
  tier_mismatch: 'TIER_MISMATCH',
  model_unavailable: 'MODEL_UNAVAILABLE',
  content_blocked: 'CONTENT_BLOCKED',
  schema_invalid: 'SCHEMA_INVALID',
  provider_error: 'PROVIDER_ERROR',
  provider_unavailable: 'PROVIDER_UNAVAILABLE',
  unknown_outcome: 'UNKNOWN_OUTCOME',
};

/** The models a mock credential may use. Ids look like a provider's, not like a pretty name. */
export const MOCK_MODELS: readonly AIModelDescriptor[] = [
  { modelId: 'mock-text-1', displayName: 'Mock text 1', capabilities: ['text', 'json_schema'] },
  { modelId: 'mock-audio-1', displayName: 'Mock audio 1', capabilities: ['text', 'audio'] },
];

export interface MockAICall {
  method: 'generate' | 'validate' | 'listModels';
  modelId?: string;
  /** Length only. The prompt itself is never retained. */
  promptLength?: number;
  schemaRequested: boolean;
  outcome: string;
}

export class MockAIProvider implements AIProvider {
  readonly providerCode = MOCK_PROVIDER_CODE;
  readonly calls: MockAICall[] = [];
  defaultScenario: MockAIScenario = 'success';
  /** Reported by `validate`, so a `TIER_MISMATCH` can be produced deliberately. */
  tierSignal: DeclaredTier | undefined;
  /**
   * Returned verbatim instead of the computed text, so a caller's own output schema can be exercised.
   *
   * Needed because the deterministic default says nothing a real template's schema would accept, and a
   * test of the validation path has to be able to produce both a conforming answer and a malformed one.
   */
  jsonResponse: string | undefined;
  /**
   * Awaited immediately before `generate` returns.
   *
   * The hook exists for one class of test that cannot be written any other way: a credential revoked,
   * or a job cancelled, while the model was answering. Those races are the cases where a result must be
   * discarded rather than written, and without a seam here they could only be asserted by timing.
   */
  beforeReturn: (() => Promise<void>) | undefined;
  private queue: MockAIScenario[] = [];

  /** The next calls use these scenarios in order, then the default. */
  enqueue(...scenarios: MockAIScenario[]): this {
    this.queue.push(...scenarios);
    return this;
  }

  private next(): MockAIScenario {
    return this.queue.shift() ?? this.defaultScenario;
  }

  metadata(tier: DeclaredTier): AdapterPolicyMetadata & AdapterTermsMetadata {
    return mockMetadata(tier);
  }

  private fail<T>(scenario: MockAIScenario): AIProviderResult<T> {
    const errorClass = ERROR_FOR[scenario] ?? 'PROVIDER_ERROR';
    return {
      outcome: 'ERROR',
      errorClass,
      providerCode: `mock_${scenario}`,
      // Only where a provider would really say so; a caller must not learn a delay from a class that
      // carries none.
      ...(errorClass === 'RATE_LIMITED' ? { retryAfterSeconds: 30 } : {}),
    };
  }

  async listModels(credential: AICredentialHandle): Promise<AIProviderResult<readonly AIModelDescriptor[]>> {
    const scenario = this.next();
    // The key is still resolved on the failure paths: a provider would have sent it before failing,
    // and a mock that skipped that would hide a credential never being opened.
    await credential.withKey(async () => undefined);
    this.calls.push({ method: 'listModels', schemaRequested: false, outcome: scenario });
    if (scenario !== 'success') return this.fail(scenario);
    return { outcome: 'OK', value: MOCK_MODELS };
  }

  async validate(credential: AICredentialHandle): Promise<AIProviderResult<{ tierSignal?: DeclaredTier }>> {
    const scenario = this.next();
    await credential.withKey(async () => undefined);
    this.calls.push({ method: 'validate', schemaRequested: false, outcome: scenario });
    if (scenario !== 'success') return this.fail(scenario);
    // `undefined` by default, which is the honest answer for a provider with no reliable tier signal
    // (ADR-017 §3). A test that wants a mismatch sets it.
    return { outcome: 'OK', value: this.tierSignal ? { tierSignal: this.tierSignal } : {} };
  }

  async generate(
    credential: AICredentialHandle,
    input: AIGenerateInput,
  ): Promise<AIProviderResult<{ text: string }>> {
    const scenario = this.next();
    await credential.withKey(async () => undefined);
    this.calls.push({
      method: 'generate',
      modelId: input.modelId,
      promptLength: input.prompt.length,
      schemaRequested: input.jsonSchema !== undefined,
      outcome: scenario,
    });
    if (input.signal?.aborted) {
      // A lost lease stops the request. Unknown rather than unavailable: the runner cannot tell
      // whether the provider had already begun.
      return { outcome: 'ERROR', errorClass: 'UNKNOWN_OUTCOME', providerCode: 'mock_aborted' };
    }
    if (!MOCK_MODELS.some((m) => m.modelId === input.modelId)) {
      return this.fail('model_unavailable');
    }
    if (scenario !== 'success') return this.fail(scenario);

    // Deterministic and obviously synthetic. A mock whose output read like real clinical prose would
    // eventually be mistaken for it in a screenshot or a bug report.
    const text =
      this.jsonResponse ??
      (input.jsonSchema
        ? JSON.stringify({ synthetic: true, promptLength: input.prompt.length })
        : `SYNTHETIC mock output for ${input.prompt.length} characters of input.`);
    await this.beforeReturn?.();
    return {
      outcome: 'OK',
      value: { text },
      usage: { inputTokens: Math.ceil(input.prompt.length / 4), outputTokens: Math.ceil(text.length / 4) },
    };
  }
}
