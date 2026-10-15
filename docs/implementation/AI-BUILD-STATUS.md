# Stage 7 AI build status

**Branch** `codex/timeline-foundation`. Last verified gate: **20/20 at `2a2e9dc`** (736 unit, 51
architecture, 842 integration on MariaDB 10.6 and 11.8), tagged `stage7-cp17-ai-complete`.

Latest client verification (2026-10-15): **18/18 non-database checkpoint checks at `b5d5fe0`**,
plus **842/842 integration/security tests on each of MariaDB 10.6 and 11.8** in a separate retry.
The database retry started at `27f89ce`; later changes were web settings and documentation only.
This is combined validation, not a new single-run 20/20 verdict or release tag.

Doctor account setup at **`c902bc3`**: the non-database checkpoint passed **17/18**; two existing
unit cases hit timing limits under load. An unchanged retry passed **736/736 unit tests**. The
remaining checkpoint checks passed, including **44 browser tests**, native analysis/tests and
171-operation API parity. The changed AI HTTP suite separately passed **30/30 on both database
series**. No assertion or timeout was weakened. This is also combined validation, with no new tag.

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

1. **Production provider configuration.** The owner waived written review records as a coding
   prerequisite on 2026-10-15; implementation must continue without requesting that paperwork.
   AIREG-002/003 are inherited Gemini terms questions, not a new user requirement. This instruction
   has not changed production configuration: every provider's `productionGate` remains `OPEN`,
   which blocks activation there by design.
2. **Transcription** (V1). The route exists and returns `FEATURE_DISABLED`; `ai_transcripts` is
   deliberately not created until the feature that reads it is.

## Doctor client validation (2026-10-15)

Client implementation is in `5942a9e` and `f023489`; test corrections are in `27f89ce`.
The full run at `f023489` passed 16/20 checks, including 736 unit tests, 51 architecture tests,
API parity (171 operations), and mobile tests. Both database checks failed before tests could start
because Docker was unavailable. Docker recovered and both database series passed all 842 tests
on retry. The browser failure was an obsolete expectation that AI was still a placeholder; mobile
analysis found missing braces in a test conditional. Both were corrected in `27f89ce`; all 18
consultation browser tests and doctor-app analysis passed on retry. This is not a new full-gate
verdict; the verified gate at the top of this file remains the previous server checkpoint.

The tenant policy page at `/settings/ai` adds three browser cases covering a versioned owner save,
read-only access, stale-write refusal and clearing cached settings after access loss. Targeted
browser tests (3/3), TypeScript and changed-file lint passed. The complete browser suite passed
41/41 after phone-layout review. The latest clean commit passed all 18 non-database checkpoint
checks, including mobile format, analysis, tests and licenses. No database or provider activation
behavior changed in this page.

## Doctor account setup increment (2026-10-15)

Web and native account setup now includes current data-use statements, explicit acknowledgement,
write-only key submission, masked status, validation requests, enable/disable and revocation.
The self-service response adds only the authenticated active doctor's profile ID, including for
an empty account list. Targeted verification passed 30 AI HTTP tests on each supported MariaDB
series, 3 account browser tests, and 8 native account/review tests. Lost-create-response recovery
uses reads without resending the key; leaving during acknowledgement prevents the later save.
TypeScript compilation, doctor-app analysis and 171-operation contract parity passed. The clean-tree
checkpoint at c902bc3 passed 17/18; an unchanged unit-suite retry resolved the two timing failures
(SMS smoke guard at 5 seconds and first PDF render at 30 seconds) and passed all 736 tests. All other
checkpoint checks passed, including 44 browser flows and the full native workspace checks. The
previous single-run 20/20 verdict remains unchanged; this increment has combined validation.

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
