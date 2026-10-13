# Stage 7 AI build status

**Branch** `codex/timeline-foundation`. Last verified gate: **20/20 at `2a2e9dc`** (736 unit, 51
architecture, 842 integration on MariaDB 10.6 and 11.8), tagged `stage7-cp17-ai-complete`.

`AI-HANDOFF.md` beside this file is written for whoever takes the work over: what is load-bearing,
and the half-dozen things that will bite you.

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
| AICRED-005, §6.3, §11 | Usage endpoint with its estimate rules, credential fallback with the policy-rank refusal, and the audited raw-output read | `stage7-cp17-ai-complete` |

## Remaining

In dependency order. Each line is work, not a reminder to decide something.

1. **Web and mobile surfaces.** None of the AI work has a UI: the model picker, the draft review
   screen with its data-use label, and the approval flow with its attestation text. This is the
   largest remaining piece and the only one a doctor would notice.
2. **AIREG-002/003** register reviews, and the free-tier production gate. These are a reviewer's
   decisions rather than code, and nothing in production can use an AI credential until they happen —
   every provider's `productionGate` is `OPEN`, which blocks activation there by design.
3. **Transcription** (V1). The route exists and returns `FEATURE_DISABLED`; `ai_transcripts` is
   deliberately not created until the feature that reads it is.

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
