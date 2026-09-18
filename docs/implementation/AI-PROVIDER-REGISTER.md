# AI Provider Register

**Stage 3.1 (2026-09-17).** This is the source of truth that adapter metadata (`packages/ai-adapters/<provider>/metadata.ts`) must match. The CI test `provider-register.spec.ts` parses **§2** and fails on any divergence in `providerCode`, `tier`, `dataUsePolicy`, `productionGate`, `usageRestrictions`, `termsUrl` or `termsLastVerifiedAt`.

**Nothing here is legal advice or regulatory clearance.** Classifications are engineering risk labels derived from provider terms as read on the verification date. Quotes are short and verbatim as returned by the page reader; re-check before relying on them.

## 1. Rules

- `dataUsePolicy`:
  - `MAY_TRAIN_OR_REVIEW`: terms allow use for product improvement or training, or human review, of submitted content on that tier;
  - `NO_TRAINING_CONTRACTUAL`: terms state content is not used for training or product improvement, possibly with limited abuse-monitoring retention;
  - `UNKNOWN`: treated as `MAY_TRAIN_OR_REVIEW`.
- `productionGate`: `OPEN` (default) blocks activation in production (ADR-017 §7). It becomes `CLOSED` only with a review record id in §4.
- `termsLastVerifiedAt` older than `AI_TERMS_MAX_AGE_DAYS` (180) raises a warning metric and an admin banner. It never silently changes policy.
- **Rate limits:** no RPM/RPD numbers are recorded anywhere in this repository. The column "Limits documentation" links to the provider's current page. Runtime behavior comes from `429`/`retry-after` and `ai_usage_counters`.
- **Adding a provider** requires: a §2 row, a §3 clause entry, adapter metadata, the mock fixtures passing, and an acknowledgement text if the entry is `MAY_TRAIN_OR_REVIEW`.

## 2. Adapter metadata (normative)

| providerCode | Adapter | tier | dataUsePolicy | productionGate | usageRestrictions | Capabilities (MVP use) | termsUrl | termsLastVerifiedAt | Limits documentation |
|---|---|---|---|---|---|---|---|---|---|
| `mock` | `MockAIProvider` | FREE | MAY_TRAIN_OR_REVIEW (synthetic, exercises the may-train policy path) | OPEN (never enabled in production builds) | `SYNTHETIC_DATA_ONLY` | text, json_schema, audio (fixtures) | n/a (internal) | 2026-09-17 | n/a |
| `mock` | `MockAIProvider` | PAID | NO_TRAINING_CONTRACTUAL (synthetic) | OPEN (never enabled in production builds) | `SYNTHETIC_DATA_ONLY` | text, json_schema, audio (fixtures) | n/a (internal) | 2026-09-17 | n/a |
| `gemini` | `GeminiApiAdapter` | FREE | MAY_TRAIN_OR_REVIEW | OPEN | `NO_CLINICAL_PRACTICE_USE`, `NO_SENSITIVE_PERSONAL_DATA_FREE_TIER`, `USERS_18_PLUS`, `PAID_ONLY_FOR_EEA_UK_CH_END_USERS` | text, json_schema | https://ai.google.dev/gemini-api/terms | 2026-09-17 | https://ai.google.dev/gemini-api/docs/rate-limits |
| `gemini` | `GeminiApiAdapter` | PAID | NO_TRAINING_CONTRACTUAL | OPEN | `NO_CLINICAL_PRACTICE_USE`, `USERS_18_PLUS` | text, json_schema | https://ai.google.dev/gemini-api/terms | 2026-09-17 | https://ai.google.dev/gemini-api/docs/rate-limits |
| `openai` | `OpenAICompatibleAdapter` (base URL `https://api.openai.com/v1`) | PAID | NO_TRAINING_CONTRACTUAL | OPEN | `USAGE_POLICY_UNREVIEWED` | text, json_schema | https://developers.openai.com/api/docs/guides/your-data | 2026-09-17 | provider rate-limits guide (URL to confirm in AIREG-005) |
| `groq` | `OpenAICompatibleAdapter` (base URL `https://api.groq.com/openai/v1`) | FREE | NO_TRAINING_CONTRACTUAL | OPEN | `USAGE_POLICY_UNREVIEWED`, `JSON_SCHEMA_SUPPORT_UNVERIFIED` | text (json_schema pending) | https://console.groq.com/docs/legal/services-agreement | 2026-09-17 | https://console.groq.com/docs/rate-limits |
| `groq` | `OpenAICompatibleAdapter` | PAID | NO_TRAINING_CONTRACTUAL | OPEN | `USAGE_POLICY_UNREVIEWED`, `JSON_SCHEMA_SUPPORT_UNVERIFIED` | text (json_schema pending) | https://console.groq.com/docs/legal/services-agreement | 2026-09-17 | https://console.groq.com/docs/rate-limits |
| `mistral` | `OpenAICompatibleAdapter` (base URL `https://api.mistral.ai/v1`) | FREE | MAY_TRAIN_OR_REVIEW | OPEN | `USAGE_POLICY_UNREVIEWED`, `TRAINING_ON_BY_DEFAULT_OPT_OUT` | text | https://legal.mistral.ai/terms/commercial-terms-of-service | 2026-09-17 | not located (AIREG-006) |
| `mistral` | `OpenAICompatibleAdapter` | PAID | NO_TRAINING_CONTRACTUAL | OPEN | `USAGE_POLICY_UNREVIEWED`, `NOT_FOR_LABS_OR_PREVIEW_MODELS` | text | https://legal.mistral.ai/terms/commercial-terms-of-service | 2026-09-17 | not located (AIREG-006) |
| `openrouter` | `OpenAICompatibleAdapter` (base URL `https://openrouter.ai/api/v1`) | FREE | MAY_TRAIN_OR_REVIEW | OPEN | `USAGE_POLICY_UNREVIEWED`, `DOWNSTREAM_PROVIDER_VARIES` | text | https://openrouter.ai/docs/features/privacy-and-logging | 2026-09-17 | https://openrouter.ai/docs/faq |
| `openrouter` | `OpenAICompatibleAdapter` | PAID | UNKNOWN | OPEN | `USAGE_POLICY_UNREVIEWED`, `DOWNSTREAM_PROVIDER_VARIES`, `NO_TRAINING_ONLY_VIA_ACCOUNT_SETTING` | text | https://openrouter.ai/docs/features/privacy-and-logging | 2026-09-17 | https://openrouter.ai/docs/faq |
| `deepseek` | `OpenAICompatibleAdapter` (base URL `https://api.deepseek.com`) | PAID | UNKNOWN | OPEN | `USAGE_POLICY_UNREVIEWED`, `PROCESSING_IN_PRC` | text | https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html | 2026-09-17 | not located |
| `anthropic` | *(Future `AnthropicMessagesAdapter`; the OpenAI-compatibility layer ignores `response_format` and is not production-ready per provider docs, so not via `OpenAICompatibleAdapter`)* | PAID | NO_TRAINING_CONTRACTUAL | OPEN | `USAGE_POLICY_UNREVIEWED`, `ADAPTER_NOT_IMPLEMENTED` | — | https://www.anthropic.com/legal/commercial-terms | 2026-09-17 | https://platform.claude.com/docs/en/api/rate-limits |

**MVP enablement.**
- Configuration `AI_ENABLED_PROVIDER_CODES` defaults to `mock` locally and in CI, and `mock,gemini` in staging.
- Other rows exist so metadata, policy and UI can be built. Each still needs its own register review before being enabled anywhere with non-synthetic data.
- `deepseek` and `openrouter` are **not** enabled in any environment until their `UNKNOWN` classification and processing-region questions are reviewed.

## 3. Clause evidence

### `gemini` (Google Gemini API / Google AI Studio keys)
Terms: https://ai.google.dev/gemini-api/terms, last updated 2026-04-28 (read 2026-09-17).

- **Unpaid services use:** "Google uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products and services". Human review: "human reviewers may read, annotate, and process your API input and output."
- **Unpaid services warning:** "Do not submit sensitive, confidential, or personal information to the Unpaid Services."
- **Paid services:** "Google doesn't use your prompts … or responses to improve our products". Logging is "for a limited period of time, solely for detecting and preventing violations of the Prohibited Use Policy". Abuse-monitoring retention is "fifty-five (55) days" (https://ai.google.dev/gemini-api/docs/usage-policies, 2026-06-09).
- **When paid terms apply:** use "through a Cloud Project associated with an active billing account". Billing doc (https://ai.google.dev/gemini-api/docs/billing, 2026-09-03): AI Studio prompts are treated as paid "so long as at least 1 API project has billing enabled". Free and paid keys can coexist per project.
- **Clinical use (all tiers):** "You may not use the Services in clinical practice, to provide medical advice, or in any manner that is overseen by or requires clearance or approval from a medical device regulatory agency."
- **Age:** "You must be 18 years of age or older to use the APIs." Apps likely accessed by under-18s are barred.
- **Region:** data "may be stored transiently or cached in any country in which Google or its agents maintain facilities". No region pinning for AI Studio keys was found (Vertex AI offers regional endpoints; out of scope).
- **EEA/UK/CH end users:** "You may use only Paid Services when making API Clients available to users in the European Economic Area, Switzerland, or the United Kingdom."
- **APIs:** model list `GET https://generativelanguage.googleapis.com/v1beta/models` (https://ai.google.dev/api/models). Structured output via `generateContent` `responseMimeType` / `responseSchema` / `responseJsonSchema` (https://ai.google.dev/api/generate-content; https://ai.google.dev/gemini-api/docs/structured-output, 2026-09-02). **Server-side schema validation is still mandatory.**
- **Tier detection for `TIER_MISMATCH`:** no reliable API signal was identified, so the tier is self-declared (`tier_self_declared=true`). Stage 4 task ADAPT-003 re-checks for a signal.

### `openai`
https://developers.openai.com/api/docs/guides/your-data (no page date). `https://openai.com/enterprise-privacy/` returned 403 and was not read.
- "As of March 1, 2023, data sent to the OpenAI API is not used to train or improve OpenAI models" unless opted in.
- Abuse-monitoring logs "retained for up to 30 days, unless longer retention is required by law". Zero data retention requires "prior approval by OpenAI and acceptance of additional requirements".
- Structured outputs: `response_format` `type: "json_schema"`, `strict: true` (https://developers.openai.com/api/docs/guides/structured-outputs). Models: `GET /v1/models`.
- No free API tier found. The medical/usage policy is **not reviewed** (`USAGE_POLICY_UNREVIEWED`).

### `groq`
https://console.groq.com/docs/legal/services-agreement (last modified 2026-06-22).
- "Groq is not permitted to use Inputs or Outputs for training or fine-tuning any AI Model Services or other models, unless explicitly granted permission or instructed by Customer."
- Data location: "All customer data is retained in Google Cloud Platform (GCP) buckets located in the United States." Default inference retention: none, with exceptions up to 30 days for reliability and abuse monitoring (https://console.groq.com/docs/your-data).
- Free plan exists (https://console.groq.com/docs/rate-limits). The agreement covers services "provided free of charge", and no separate free-tier data clause was found, so FREE is classified `NO_TRAINING_CONTRACTUAL` with **PARTIAL** confidence (AIREG-004).
- OpenAI-compatible base URL: `https://api.groq.com/openai/v1` (https://console.groq.com/docs/openai). `json_schema` support is not confirmed.

### `mistral`
- Free (Experiment) plan: "we may use your data (input and output) to train our artificial intelligence models" (opt-out available) (https://help.mistral.ai/en/articles/347617-do-you-use-my-user-data-to-train-your-artificial-intelligence-models).
- Commercial terms (effective 2026-08-05): no training on customer data except listed cases, including "When Customer uses Labs or Preview Models", where opt-outs "does not apply".
- Paid classification is PARTIAL. Retention and hosting region are not verified. OpenAI-compatible via base URL change (https://docs.mistral.ai/resources/migration-guides).

### `openrouter`
- "OpenRouter does not store your prompts or responses, *unless* you opt in." "If you opt out of training in your account settings, OpenRouter will not route to providers that train." Paid and free models have "separate settings" (https://openrouter.ai/docs/features/privacy-and-logging).
- `:free` variants are "A free version of the model with its own rate limits".
- Downstream provider retention varies, so paid is `UNKNOWN`. A no-training guarantee depends on an **account setting**, not a contract term the platform can verify, and that setting is never trusted as a policy input (ADR-017 §3).

### `deepseek`
- Privacy policy (2026-02-10): "we directly collect, process and store your Personal Data in People's Republic of China." Personal data used "to train and improve our technology". The platform terms (effective 2026-04-29) have no API training clause, and the governing law is the PRC.
- Classified `UNKNOWN`. Not enabled anywhere.

### `anthropic`
- Commercial terms (effective 2025-06-17): "Anthropic may not train models on Customer Content from Services."
- OpenAI SDK compatibility layer: "not considered a long-term or production-ready solution"; `response_format` is "Ignored" (https://platform.claude.com/docs/en/api/openai-sdk). A native adapter is Future.

## 4. Open gates (block production enablement with real patient data)

| Gate | Scope | Blocks | Owner | Resolution evidence required |
|---|---|---|---|---|
| **AIREG-001** | **AI provider use of patient data in Bangladesh** (legal/regulatory): whether sending minimized patient data to foreign AI providers, on any tier, is permissible, and under what consent, notice and processing terms | All providers, all tiers, production | Product owner + Bangladesh legal counsel | Written legal opinion referenced by id; `AI_FREE_TIER_PRODUCTION_GATE_CLOSED` may be set `true` only after this closes for free tiers |
| **AIREG-002** | Gemini "clinical practice" / "medical advice" clause (all tiers) vs doctor-assist drafting | `gemini` FREE and PAID production gates | Product owner + counsel | Review record; otherwise a decision to switch the default provider |
| **AIREG-003** | Gemini unpaid "Do not submit sensitive … personal information" vs minimized clinical text | `gemini` FREE | Product owner + counsel | Review record |
| **AIREG-004** | Groq free-tier data terms confidence (PARTIAL); `json_schema` support; medical use policy | `groq` | Engineering + counsel | Terms clause + adapter test |
| **AIREG-005** | OpenAI usage policies for health use; enterprise privacy page (403); rate-limit doc URL | `openai` | Engineering + counsel | Clause review |
| **AIREG-006** | Mistral paid-tier training/retention/region; Labs/Preview model exclusion enforcement in catalog | `mistral` | Engineering + counsel | Clause review; catalog filter test |
| **AIREG-007** | OpenRouter downstream provider terms; DeepSeek PRC processing | `openrouter`, `deepseek` | Product owner | Decision to keep disabled or review |
| **AIREG-008** | Minimization adequacy review on a synthetic evaluation set (Bangla/Banglish, free-text identifiers) | All `MAY_TRAIN_OR_REVIEW` entries | Engineering + clinical reviewer | Evaluation report with residual-identifier rate |
| **AIREG-009** | Clinical safety review of MVP templates (`note-draft`, `history-summary`) | All providers | Clinical lead | Review record per template version |

## 5. Data location notes (feeds the Bangladesh research register)

| Provider | Processing / storage notes | Status |
|---|---|---|
| Gemini API (AI Studio) | Any country where Google or its agents maintain facilities; no region pinning for AI Studio keys | VERIFIED (terms) |
| OpenAI | Regional processing for eligible customers (US/Europe/UAE); default storage not asserted here | PARTIAL |
| Groq | Customer data retained in GCP buckets in the United States | VERIFIED |
| Mistral | Not verified | UNVERIFIED |
| OpenRouter | Depends on downstream provider; EU/US routing enterprise-only | VERIFIED |
| DeepSeek | People's Republic of China | VERIFIED |
| Anthropic | Not checked | UNVERIFIED |
