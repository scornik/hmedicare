import type { AdapterPolicyMetadata, DeclaredTier } from '../policy/effective-policy';

/**
 * `AIProvider` (ADAPT-001, ADR-017 §5).
 *
 * The seam between this system and a model vendor. Adapters translate; they never decide. Whether a
 * call is permitted at all is settled by `evaluateAIPolicy` before anything reaches here, and an
 * adapter that consulted the tenant policy or the patient's consent would be a second place for those
 * rules to drift apart from the first.
 *
 * Two shapes carry most of the weight.
 *
 * **The error taxonomy is closed.** Every failure an adapter can produce maps to one of these classes,
 * because the caller's behaviour depends on the class rather than on the vendor's prose: a quota
 * refusal reschedules, an invalid credential stops and marks the credential, a tier mismatch refuses
 * activation, and an unknown outcome is the one case where the caller cannot tell whether the request
 * was processed. A vendor message that does not map is `PROVIDER_ERROR`, never a guess.
 *
 * **Adapters return results, they do not throw.** A thrown vendor error carries a request body, a URL
 * with a key in it, or a stack naming internal paths; each of those is a way for a credential or a
 * patient's text to reach a log. `AIProviderResult` makes the failure path ordinary data, and the
 * credential store already sanitizes anything that escapes anyway.
 */
export type AIErrorClass =
  /** The key is wrong, revoked or not accepted by the provider. */
  | 'INVALID_CREDENTIAL'
  /** Out of quota or rate limited. `retryAfterSeconds` says when, if the provider said. */
  | 'QUOTA_EXHAUSTED'
  /** The provider reports a tier that contradicts the doctor's declaration (ADR-017 §3). */
  | 'TIER_MISMATCH'
  /** The requested model is absent from the provider or from the catalog. */
  | 'MODEL_NOT_AVAILABLE'
  /** The provider refused the content on its own policy grounds. */
  | 'CONTENT_REFUSED'
  /** The response did not satisfy the schema that was requested. */
  | 'SCHEMA_VIOLATION'
  /** Reached the provider, got an error this adapter has no better name for. */
  | 'PROVIDER_ERROR'
  /** Provably never processed: connect or DNS failure before request bytes went out. */
  | 'PROVIDER_UNAVAILABLE'
  /** Timeout after sending, or an unparseable body. The caller cannot assume it did not happen. */
  | 'UNKNOWN_OUTCOME';

/** Classes where the request provably never reached the model, so a retry is safe. */
export const AI_SAFE_TO_RETRY: readonly AIErrorClass[] = ['PROVIDER_UNAVAILABLE'];

/** Classes that describe the credential rather than the request, so retrying changes nothing. */
export const AI_CREDENTIAL_FAULTS: readonly AIErrorClass[] = [
  'INVALID_CREDENTIAL',
  'QUOTA_EXHAUSTED',
  'TIER_MISMATCH',
];

export interface AIModelDescriptor {
  /** The provider's own identifier, used verbatim. Never constructed here (ADAPT-002). */
  modelId: string;
  displayName: string;
  capabilities: readonly ('text' | 'json_schema' | 'audio' | 'vision')[];
}

export interface AIGenerateInput {
  modelId: string;
  /** Already minimized when the policy required it; adapters do not inspect for identifiers. */
  prompt: string;
  /** A JSON Schema the provider should honour. Validation server-side is still the caller's job. */
  jsonSchema?: Record<string, unknown>;
  maxOutputTokens?: number;
  /** Abort signal from the job runner, so a lost lease stops the request. */
  signal?: AbortSignal;
}

export interface AIUsageEstimate {
  /** Provider-reported where available. Labelled an estimate wherever it is shown (AICRED-005). */
  inputTokens?: number;
  outputTokens?: number;
}

export type AIProviderResult<T> =
  | { outcome: 'OK'; value: T; usage?: AIUsageEstimate }
  | {
      outcome: 'ERROR';
      errorClass: AIErrorClass;
      /** The provider's own code, for diagnosis. Never its message, which may quote the request. */
      providerCode?: string;
      retryAfterSeconds?: number;
    };

/**
 * A resolved credential, usable only inside the callback the secret owner opens.
 *
 * The key is never a field on this object: `withKey` hands it to the adapter for the duration of one
 * call, which is what keeps it out of payloads, logs and errors.
 */
export interface AICredentialHandle {
  credentialId: string;
  providerCode: string;
  declaredTier: DeclaredTier;
  withKey<T>(fn: (apiKey: string) => Promise<T>): Promise<T>;
}

export interface AIProvider {
  readonly providerCode: string;
  /** One entry per `(providerCode, tier)`, matching AI-PROVIDER-REGISTER.md §2. */
  metadata(tier: DeclaredTier): AdapterPolicyMetadata & AdapterTermsMetadata;
  /** The models this credential may use, for the catalog refresh (ADAPT-002). */
  listModels(credential: AICredentialHandle): Promise<AIProviderResult<readonly AIModelDescriptor[]>>;
  /** Text generation, optionally schema-constrained. */
  generate(
    credential: AICredentialHandle,
    input: AIGenerateInput,
  ): Promise<AIProviderResult<{ text: string }>>;
  /**
   * Validates a credential without doing clinical work (AICRED-004).
   *
   * Separate from `generate` because validation must not send patient data: it is the one call made
   * before a credential is trusted, and the cheapest provider request that proves the key works.
   */
  validate(credential: AICredentialHandle): Promise<AIProviderResult<{ tierSignal?: DeclaredTier }>>;
}

/** The register columns that are not policy inputs but must still match §2. */
export interface AdapterTermsMetadata {
  termsUrl: string;
  /** ISO date. Older than `AI_TERMS_MAX_AGE_DAYS` raises a warning, never a policy change. */
  termsLastVerifiedAt: string;
  processingRegionNotes: string;
}
