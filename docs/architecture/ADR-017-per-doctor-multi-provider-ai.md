# ADR-017 — Per-doctor, multi-provider AI credentials with enforced data-use safeguards

**Status:** Accepted (Stage 3.1, 2026-09-17)
**Refines:** ADR-008 (AI approval architecture). ADR-008 is unchanged: AI creates drafts and suggestions only, and only explicit doctor approval creates clinical records. This ADR decides **whose credentials** call **which providers**, and what safeguards must hold before patient data leaves the platform.
**Related:** ADR-013 (hosting: no KMS), ADR-015 (job queue), ADR-016 (raw-output storage), `docs/implementation/AI-IMPLEMENTATION.md`, `docs/implementation/AI-PROVIDER-REGISTER.md`.

## Context

- Hakeemify's product decision: **each doctor brings their own AI key.**
  - **Default:** the doctor's own Google AI Studio (Gemini API) key on the **free tier**.
  - **Optional:** doctors who agree to pay use a paid key (BYOK), including Gemini with billing enabled on their own project.
  - **Platform-managed paid key** (Hakeemify pays and bills the doctor) must be designed but disabled.
- **Provider terms differ by tier.** Google's Gemini API terms describe free-tier (unpaid) content as usable for improving Google products, including human review. Paid-tier content is described as not used for that purpose. Other providers' free tiers have similar or unknown terms. See `AI-PROVIDER-REGISTER.md` for the clauses and last-verified dates.
- **Rate limits and model availability change often**, so they cannot be constants.
- **AI must stay optional.** The manual workflow must be unaffected when no credential exists.
- **Hosting has no key-management service** (ADR-013), so secrets need application-level envelope encryption.

## Decision

### 1. Ownership

- An AI credential belongs to **one doctor within one tenant**: `(tenant_id, doctor_profile_id)`.
- A doctor who works in two tenants configures credentials separately in each. Credentials are never shared across tenants.
- The owning doctor manages their own credentials.
- A member with the explicit grant **`ai.credentials.manage`** (for example a clinic admin) may **add, replace, disable or revoke** a doctor's credential. **Nobody can read a saved secret back**, including that member and the owning doctor. Only `secret_last4`, provider, tier, status and usage are visible.
- Jobs for a doctor may only use that doctor's credentials. Staff-triggered AI actions for a doctor's encounter are not allowed in MVP; AI jobs are doctor-triggered.

### 2. Billing modes

| `billing_mode` | Meaning | MVP |
|---|---|---|
| `DOCTOR_BYOK_FREE` | Doctor's own key on a provider free tier | **Default mode** |
| `DOCTOR_BYOK_PAID` | Doctor's own key on a paid tier (e.g. Gemini with Cloud Billing enabled) | Enabled |
| `PLATFORM_MANAGED` | Hakeemify-held key; usage metered for future billing | **Designed, disabled** behind `AI_PLATFORM_MANAGED_ENABLED=false`. Only metering tables (`ai_usage_ledger`) and ports exist; no billing tables or endpoints (billing stays Future per the consistency audit). |

### 3. Encoded data-use policy (not just documentation)

- **Static adapter metadata.** Every provider adapter declares, in code under `packages/ai-adapters/<provider>/metadata.ts`, one entry per `(providerCode, tier)`:
  - `dataUsePolicy`: `MAY_TRAIN_OR_REVIEW` | `NO_TRAINING_CONTRACTUAL` | `UNKNOWN`;
  - `tier`: `FREE` | `PAID`;
  - `processingRegionNotes`;
  - `termsUrl`;
  - `termsLastVerifiedAt`;
  - `capabilities` (text, jsonSchema, audio, vision).
  
  The metadata matches a row in `AI-PROVIDER-REGISTER.md`, and a CI test fails if the two diverge (the register is parsed as a table).
- **Effective policy:**
  ```text
  effective_data_use_policy = metadata(provider_code, declared_tier).dataUsePolicy, with UNKNOWN treated as MAY_TRAIN_OR_REVIEW
  ```
  It comes only from adapter metadata and the declared tier. It is **never** derived from user-typed text, and a user cannot declare a stricter policy than the metadata allows.
- **Declared tier.** The doctor declares `FREE` or `PAID`.
  - Where the provider exposes a reliable signal, validation compares it with the declaration. On a mismatch the credential cannot activate, with `last_error_class=TIER_MISMATCH`.
  - Where no reliable signal exists, the declaration stands. The acknowledgement text states that the doctor is responsible for the declaration.
  - A `PAID` declaration that cannot be verified is still treated as `PAID` for policy purposes, but the UI labels it "tier self-declared".
- **Hard preconditions** for any job whose credential's effective policy is `MAY_TRAIN_OR_REVIEW`. **All** must hold; the job is refused with `POLICY_BLOCKED` otherwise:
  1. **Tenant opt-in.** The tenant AI policy has `free_tier_ai_allowed = true`. The default is `false` (`AI_FREE_TIER_ALLOWED_DEFAULT=false`). Opting in is a `tenant_owner` action (`ai.policy.manage`), recorded with policy version, actor and time.
  2. **Doctor acknowledgement.** The doctor has an active `ai_data_use_acknowledgements` row for that provider, tier and the **current** terms-text version. A new text version invalidates older acknowledgements, and the credential returns to `PENDING_VALIDATION` until the doctor re-acknowledges.
  3. **Patient consent.** The patient whose data is used has an active `patient_consents` row with purpose `ai_assistance`.
  4. **Minimization.** The `PhiMinimizationService` has run and succeeded. On failure the job fails with `PHI_MINIMIZATION_FAILED` and **nothing is sent**.
  5. **Text only.** Audio transcription and raw document or image sending are blocked for these credentials (`POLICY_BLOCKED`, reason `RAW_MEDIA_NOT_ALLOWED_FOR_POLICY`), because identifiers cannot be reliably removed from raw media.
- **`NO_TRAINING_CONTRACTUAL` credentials** still require tenant AI enablement, patient consent, and minimization by default. A tenant owner may set `minimization_required_for_no_training = false` through a recorded policy decision. That relaxation is an internal risk decision, **not a legal claim**, and the UI says so.
- **Visibility.** The UI shows the credential's data-use class (for example "Free tier — provider may use data to improve its products") next to every AI action and in the draft review screen.
- **Legal gate.** "AI provider use of patient data in Bangladesh" is an **open research gate**. Until it is closed, free-tier AI **must not be enabled with real patient data in production**. This is enforced by the production readiness checklist, plus a startup check: if `APP_ENV=production` and `AI_FREE_TIER_PRODUCTION_GATE_CLOSED != true`, the policy engine forces `free_tier_ai_allowed = false` for every tenant. Development and staging use synthetic data only.

### 4. Secrets

- **Envelope encryption.**
  - A per-credential random 256-bit data key encrypts the secret with AES-256-GCM.
  - The data key is itself wrapped by the key-encryption key `AI_CREDENTIAL_KEK` (32 random bytes, base64) identified by `AI_CREDENTIAL_KEK_ID`.
  - Stored fields: `encrypted_secret` (ciphertext + IV + tag), `wrapped_data_key`, `key_id`.
  - Additional authenticated data (AAD) = `credential_id|tenant_id|doctor_profile_id|provider_code`, so ciphertext moved to another row fails to decrypt.
- **Key rotation** (no KMS on the plan):
  1. Add the new KEK as `AI_CREDENTIAL_KEK` and `AI_CREDENTIAL_KEK_ID`, keeping the old one in `AI_CREDENTIAL_KEK_PREVIOUS` / `AI_CREDENTIAL_KEK_PREVIOUS_ID`.
  2. Run the `ReencryptAICredentials` job, which rewraps data keys in batches and is idempotent by `key_id`.
  3. Verify no rows still reference the old key id.
  4. Remove the previous KEK.
  
  Each step is audited.
- **Never exposed.** Secrets are never returned after save, never logged, never placed in job payloads (jobs carry `credential_id` only), never exported, and never cached in plaintext beyond the single provider call. The decrypted value lives only inside the adapter call scope. Buffers are overwritten after use where the runtime allows; this is best-effort in Node and documented as such.
- **Fingerprint.** `secret_fingerprint = HMAC-SHA-256(AI_CREDENTIAL_FINGERPRINT_PEPPER, secret)` enables duplicate detection without storing a reversible hash.
- **Validation job.** Saving a key creates the credential in `PENDING_VALIDATION` and enqueues `ValidateAICredential`, a minimal non-PHI call such as a model list or a fixed synthetic prompt, which sets `ACTIVE`, `INVALID` or `QUOTA_EXHAUSTED`.
- **Revocation is immediate.** Status `REVOKED` commits synchronously. Runners re-read credential status immediately before the provider call, and again before persisting results; in-flight jobs fail with `AI_CREDENTIAL_REVOKED` and results obtained after revocation are discarded.

### 5. Providers and adapters

- **`AIProvider` port:** `validateCredential`, `listModels`, `generateStructured(schema, messages, options)`, `transcribe` (capability-gated), `countTokens` (optional), with a normalized error taxonomy:
  - `INVALID_CREDENTIAL`
  - `RATE_LIMITED` (with `retryAfter`)
  - `QUOTA_EXHAUSTED`
  - `MODEL_UNAVAILABLE`
  - `CONTENT_BLOCKED`
  - `SCHEMA_INVALID`
  - `TIMEOUT`
  - `PROVIDER_ERROR`
  - `PHI_MINIMIZATION_FAILED`
  - `POLICY_BLOCKED`
  - `AI_CREDENTIAL_REVOKED`
- **MVP adapters:** `MockAIProvider` (deterministic, fixtures for every error class), `GeminiApiAdapter` (Google AI Studio key; free or paid by declaration), `OpenAICompatibleAdapter` (configurable base URL; each concrete provider still needs its own metadata entry and register row before it can be selected).
- Additional named adapters are Future. Their metadata slots are defined in the register. Vendor SDKs may be imported **only** inside `packages/ai-adapters/*`, enforced by dependency-cruiser.
- **Models** come from `ai_model_catalog`, refreshed by a job through provider list-models APIs where available. No model ID is hard-coded in business code: defaults come from the catalog plus configuration, and tests use mock model IDs.
- **Rate limits** are configuration plus observed provider responses (`429`/`retry-after`) recorded in `ai_usage_counters`. No RPM/RPD numbers appear in code or docs; the register links to the providers' current documentation.

### 6. Execution

- **Jobs.** AI jobs run through ADR-015 with `concurrency_key = ai-credential:<credential_id>`. Default concurrency is 1 per credential, configurable per credential up to `AI_MAX_CONCURRENCY_PER_CREDENTIAL`.
- **`RATE_LIMITED`** moves the job to `WAITING_RATE_LIMIT` until `retry_after` without consuming an attempt, up to `AI_RATE_LIMIT_MAX_WAIT_SECONDS`.
- **`QUOTA_EXHAUSTED`** marks the credential `QUOTA_EXHAUSTED` and fails the job with a doctor-readable message.
- **Fallback between credentials** happens only if **all** hold:
  - the doctor configured a fallback order;
  - the fallback credential is `ACTIVE`;
  - its effective policy is **equal or stricter** (`NO_TRAINING_CONTRACTUAL` ≥ `MAY_TRAIN_OR_REVIEW`);
  - its model supports the required capability;
  - all preconditions in §3 hold for the fallback's policy.
  
  There is **never** fallback to a platform-managed key, and **never** from a no-training credential to a may-train credential.
- **Provenance.** Every job records provider, model, tier, billing mode, effective policy, prompt template version, output schema version, minimization report (categories and counts only), usage, and error class.
- **Quota display.** Doctors see used and remaining estimates derived from counters and provider headers, labeled "estimate".

### 7. Provider usage restrictions and the provider production gate (added after terms review, 2026-09-17)

**Conflict discovered.** The Gemini API Additional Terms (last updated 2026-04-28; `AI-PROVIDER-REGISTER.md` row `gemini`) state, for **all** tiers:
- "You may not use the Services in clinical practice, to provide medical advice, or in any manner that is overseen by or requires clearance or approval from a medical device regulatory agency."
- For the unpaid tier: "Do not submit sensitive, confidential, or personal information to the Unpaid Services."
- The APIs require users to be 18+, and are barred for apps "likely to be accessed by individuals under the age of 18".

The product's default mode (doctor's own Gemini free-tier key used during consultations) is therefore **in tension with the provider's own terms**, independent of our minimization safeguards. This ADR does not resolve that legal question and makes no compliance claim. It records the conflict (consistency audit C-02) and encodes a gate:

1. **Usage restrictions in adapter metadata.** Each metadata entry carries `usageRestrictions: UsageRestriction[]` (e.g. `NO_CLINICAL_PRACTICE_USE`, `NO_SENSITIVE_PERSONAL_DATA_FREE_TIER`, `USERS_18_PLUS`, `PAID_ONLY_FOR_EEA_UK_CH_END_USERS`) and `productionGate: 'OPEN' | 'CLOSED'`, where `CLOSED` means a documented legal/product review accepted use with real patient data for that `(provider, tier)`. **All provider entries start `OPEN`.**
2. **Enforcement.** When `APP_ENV=production`, a credential for a `(provider, tier)` whose gate is `OPEN` cannot become `ACTIVE`. Validation leaves it `PENDING_VALIDATION` with `POLICY_BLOCKED` / `PROVIDER_PRODUCTION_GATE_OPEN`. The gate is closed only by changing adapter metadata and the register together, in a reviewed change referencing the review record. There is no runtime override. Development and staging (synthetic data only) are unaffected, so the Gemini free-tier default mode can be built and tested end to end.
3. **Default mode stays as specified** (Gemini free tier is the first-offered option in the credential UI), because the product brief requires it and because it is buildable and testable. **Production enablement of any provider with real patient data is blocked** until the register gate for that provider/tier is closed. For Gemini specifically, the clinical-practice clause must be reviewed first. Evaluating alternatives is recorded as an external product decision: providers whose terms have no clinical-use prohibition and a contractual no-training commitment (register candidates: OpenAI API paid, Anthropic API paid via a future native adapter, Groq, Mistral paid), subject to the same review.
4. **Patient-facing apps never call AI** (doctor-triggered only), which keeps AI out of apps that minors may use. The age restriction is recorded for review, not resolved.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Single platform key for everyone | Hakeemify bears cost and data-processing responsibility before billing exists; conflicts with the product decision. Kept as disabled `PLATFORM_MANAGED`. |
| Trust a user-entered "this provider doesn't train" flag | Policy would depend on unverified user input. Rejected: policy is derived from reviewed metadata only. |
| Allow audio/images on free tier with best-effort redaction | Identifiers in voice and images cannot be reliably removed. Rejected for may-train credentials. |
| Store keys hashed only | The platform must replay the key to the provider, so encryption is required. |

## Consequences

- Each doctor's free-tier limits, outages and terms changes are isolated per credential. The UX must explain quotas and data-use classes clearly.
- The register and adapter metadata need periodic review. `termsLastVerifiedAt` older than `AI_TERMS_MAX_AGE_DAYS` (default 180) raises a warning metric and admin banner. It does not silently change policy.
- Minimization reduces clinical context in prompts, such as exact dates becoming relative days. Evaluation must measure the draft-quality impact on synthetic data.
- No part of this ADR is legal or regulatory clearance.
