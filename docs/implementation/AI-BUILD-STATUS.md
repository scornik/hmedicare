# Stage 7 AI build status

**Branch** `codex/timeline-foundation`. Last verified gate: **20/20 at `d21d39d`** (736 unit, 51
architecture, 824 integration on MariaDB 10.6 and 11.8), tagged `stage7-cp16-ai-approval`.

This file is a working status note, not a specification. The specifications are ADR-017,
`AI-IMPLEMENTATION.md`, `AI-PROVIDER-REGISTER.md` and `IMPLEMENTATION-BACKLOG.md`.

## Done

| Item | What landed | Tag |
|---|---|---|
| AIPOL-001/002, AICRED-003 | Tenant AI policy on a verified chain, data-use acknowledgements, credential storage, AI HTTP surface | `stage7-cp12-ai-foundation` |
| ADAPT-001 | `AIProvider` port with a closed error taxonomy, mock adapter, provider register | `stage7-cp12-ai-foundation` |
| AICRED-004 | `ValidateAICredential`: one provider call settles the credential; rate limit defers without moving the status | `stage7-cp12-ai-foundation` |
| AIPOL-004 | `PhiMinimizationService`: known values, pattern layer, residual scan, fail-closed, restore | `stage7-cp12-ai-foundation` |
| ADAPT-002 | `ai_model_catalog`, `RefreshAIModelCatalog`, `GET /ai/models`, `hmedic/no-hardcoded-model-id` | `stage7-cp13-ai-adapters` |
| ADAPT-003 | `GeminiApiAdapter` over recorded synthetic fixtures; tier-signal question settled and dated | `stage7-cp13-ai-adapters` |
| ADAPT-004 | `OpenAICompatibleAdapter` for `openai`, `groq`, `mistral`, `openrouter`, `deepseek` | `stage7-cp13-ai-adapters` |
| AI-001 (part) | Migration 0025 tables, prompt templates with a lock file, retrieval, `AIJobStore`, `RunAIJob` | `stage7-cp14-ai-jobs` |
| AI-001 (HTTP) | Job creation, status, cancel, transcription refusing with `FEATURE_DISABLED` | `stage7-cp15-ai-review` |
| AI-002 | Draft review: read, open, close, suggestion decisions with row-version conflicts, `ExpireAIDrafts` | `stage7-cp15-ai-review` |
| AI-003 | `ApproveAISuggestion` in the clinical context — one transaction for the clinical write, the hash-chained approval and the suggestion status — plus the §7.5 worker-boundary tests | `stage7-cp16-ai-approval` |

## Remaining

In dependency order. Each line is work, not a reminder to decide something.

1. **AICRED-005, the usage endpoint.** `GET /doctors/me/ai/usage` reporting per-credential request
   and token counts with `estimatedRemaining` only where a `quota_hint` was configured, and always
   labelled an estimate. `ai_usage_counters` and `ai_usage_ledger` are already written on every
   provider call, so this is a read surface over data that exists.
2. **Fallback between credentials** (§6.3). `ai_credential_fallbacks` exists and the runner settles a
   spent or rejected credential, but it does not yet try the doctor's next one. The rule that matters
   is the policy-rank comparison: a fallback may never be more permissive than the credential it
   replaces.
3. **`GET /ai/raw-outputs/{jobId}`** for `ai.audit.raw_read`, audited, streamed, and explicitly not
   for clinical use. The objects are already stored post-minimization under `ai-raw`.
4. **Web and mobile surfaces.** None of the AI work has a UI yet: the model picker, the draft review
   screen with its data-use label, and the approval flow with its attestation text.
5. **AIREG-002/003** register reviews, and the free-tier production gate. These are a reviewer's
   decisions rather than code, and nothing in production can use an AI credential until they happen.

## Open items that are not code

- **Rotate the ZamanIt API key.** It was pasted in plaintext into a chat during the production
  bring-up and should be treated as disclosed.
- **Change the platform operator password** set during the same bring-up.
- **`GATE-SMS-HTTP` expires 2027-01-05.**
- **MAIL-001** (email OTP transport) is specified in ADR-025 and unstarted; email OTP currently runs
  through the mock adapter outside production.
- The free-tier production gate is still open, by design: ADR-017 §7 keeps
  `AI_FREE_TIER_PRODUCTION_GATE_CLOSED=false` until the Bangladesh data-use question is reviewed. No
  AI credential can activate in production while every provider's gate is `OPEN`.
