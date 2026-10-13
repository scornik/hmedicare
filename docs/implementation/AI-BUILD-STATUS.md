# Stage 7 AI build status

**Branch** `codex/timeline-foundation`. Last verified gate: **20/20 at `775b519`** (718 unit, 51
architecture, 768 integration on MariaDB 10.6 and 11.8), tagged `stage7-cp14-ai-jobs`.

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

## Remaining

In dependency order. Each line is work, not a reminder to decide something.

1. **AI job HTTP surface.** `POST /encounters/{id}/ai/note-draft` and `…/history-summary`,
   `POST …/ai/transcription` returning `FEATURE_DISABLED`, `GET /ai/jobs/{id}`,
   `POST /ai/jobs/{id}/cancel`. The store behind all of these exists and is tested; the routes and
   contracts do not.
2. **AI-002, draft review.** `GET /ai/drafts/{id}`, `open`/`close`, `POST /ai/suggestions/{id}/review`,
   and `ExpireAIDrafts`. The tables and their state CHECKs exist.
3. **AI-003, approval.** `POST /ai/suggestions/{id}/approve`. This one needs a change outside the AI
   context: `AI-IMPLEMENTATION.md` §7.4 requires the clinical command to run **inside the approval
   transaction**, and `DiagnosisService.add` / `NoteService.saveDraft` currently open their own. They
   need to accept an outer transaction context before the approval can be atomic. Doing it any other
   way would leave a window where an approval exists and the diagnosis does not, or vice versa.
4. **DI enforcement tests** (§7.5): a worker-container test asserting that `AddDiagnosis`,
   `SaveEncounterNote` and friends cannot be resolved there, plus the repository check that every
   `diagnoses` row with `source='ai_approved'` has an approval behind it. The database CHECK already
   enforces the second; the test makes the first a property of the build.
5. **AICRED-005** usage endpoint, and the remaining register review gates (AIREG-002/003), which are
   decisions for a reviewer rather than code.

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
