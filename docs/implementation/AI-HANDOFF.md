# Handoff — Stage 7 AI, branch `codex/timeline-foundation`

Written for whoever takes this over. It assumes you will read the specifications
(`ADR-017`, `AI-IMPLEMENTATION.md`, `AI-PROVIDER-REGISTER.md`, `IMPLEMENTATION-BACKLOG.md`) and not
this file, which exists to tell you where things stand, what is load-bearing, and what I would
check first.

## State

Last gate: **20/20** (see `AI-BUILD-STATUS.md` for the verified commit and counts). Tags
`stage7-cp12-ai-foundation` through `stage7-cp16-ai-approval` each mark a 20/20 run.

Phase 10 is functionally complete server-side: policy, acknowledgements, credentials, validation,
minimization, the model catalog, three adapters, job execution, drafts, review, approval, usage,
fallback and the raw-output read. Doctor web and native AI request/review/approval screens now exist
(2026-10-15). Web tenant policy settings and web/native doctor account setup also exist. See the client
checkpoint entry in `AI-BUILD-STATUS.md` for validation status.

## Read these first

In this order, because each explains the next:

1. `packages/ai/src/application/providers/ai-provider-port.ts` — the error taxonomy. Every caller
   branches on the class, so the taxonomy is the contract. `UNKNOWN_OUTCOME` is in neither
   `AI_SAFE_TO_RETRY` nor `AI_CREDENTIAL_FAULTS` on purpose.
2. `packages/ai/src/application/minimization/phi-minimization.ts` — fail-closed identifier removal.
   Read §5.5 of `AI-IMPLEMENTATION.md` alongside it; the limits are real and documented.
3. `packages/ai/src/infrastructure/ai-job-runner.ts` — the order of the steps *is* the safety
   property. Claim, check, retrieve, minimize, throttle, re-check, call, record, validate, restore,
   persist.
4. `packages/clinical/src/infrastructure/ai-approval-service.ts` — the only path from a draft to a
   chart.

## Things that will bite you

Each of these cost me a debugging cycle. They are not obvious from the code.

- **Lock ranks.** `ai_jobs`/`ai_drafts`/`ai_suggestions` are 30–32, *below* the clinical tables,
  because the approval locks the AI rows and then writes a note or diagnosis.
  `integrity_chain_checkpoints` is 80, so any row you intend to lock must be locked **before** a
  chain append or an audit write. That is why `AIApprovalService.resolveTarget` locks the note.
- **Circular FK on approval.** `diagnoses.ai_approval_id` references `ai_approvals`, so the approval
  row is written *first* and names the record it is about to create. Do not "tidy" that order.
- **`ENTERED_IN_ERROR` is the voided state** on `diagnoses` — a CHECK ties the status and the void
  fields together. One condition covers both.
- **One live acknowledgement per (doctor, provider, tier).** Two credentials on the same terms share
  it, and `fk_ai_credential_ack_scope` refuses a PAID credential pointing at a FREE-tier ack.
- **Subscribed job handlers receive `{ v, eventId, eventType, aggregateId }`** and the tenant on the
  job row — not a payload of their own choosing. I fixed `RecordMedicationUsage`, which had declared
  its own shape and would never have run.
- **A `.refine` on a member of a Zod `discriminatedUnion` is erased** when the union is built. The
  diagnosis code/system rule lives on the output object for that reason.
- **Do not edit the tree while a gate runs.** I did once and got a false `openapi:check` failure.
- **`prompts.lock.json` must be regenerated** if Prettier reformats a template. Build `@hmedic/ai`
  first, then run `promptFileHashes()` from `dist`.

## Tests worth understanding before changing behaviour

- `packages/ai/test/unit/phi-minimization.test.ts` — Stage 7 mandatory test T8. Includes a case that
  asserts deliberate **over**-redaction when a clinical word shares a name's skeleton. That is the
  trade-off, recorded so nobody "fixes" it silently.
- `packages/ai/test/integration/run-ai-job.test.ts` — every refusal before anything is sent, both
  mid-call races, and fallback including the policy-rank refusal.
- `packages/clinical/test/integration/ai-approval.test.ts` — atomicity is asserted by its failures:
  when the note write refuses, no approval row exists.
- `apps/worker/test/integration/worker-shell.test.ts` — the §7.5 boundary. The worker cannot resolve
  `CLINICAL_SERVICES` and still runs every AI job.
- `packages/clinical/test/integration/note-lifecycle.test.ts` pins `NoteService`'s method names. A
  new mutator has to be argued for there.

## What is left

`docs/implementation/AI-BUILD-STATUS.md` carries the list; the short version:

1. **Client surfaces are implemented and validated.** The doctor model picker, draft review,
   data-use labels, attested approval and account setup exist on web/native, plus web tenant policy
   settings. See the combined validation at c902bc3 in AI-BUILD-STATUS.md; do not treat this as a new
   single-run release gate or tag.
2. **Production provider configuration.** On 2026-10-15 the owner waived written review records as
   a prerequisite to continuing implementation. Do not ask for those records again to continue
   coding. This does not itself change deployed configuration or establish current provider terms:
   every provider's `productionGate` remains `OPEN`, which blocks production credential activation.
3. **Transcription** (V1). The route exists and refuses with `FEATURE_DISABLED`; `ai_transcripts` is
   deliberately not created yet.

## Not code, and not mine to do

- **Rotate the ZamanIt API key.** It was pasted in plaintext into a chat during the production
  bring-up; treat it as disclosed.
- **Change the platform operator password** set during the same bring-up.
- **Remove the orphaned SID with Full control over `~/.ssh`** (present since 2026-09-14).
- `GATE-SMS-HTTP` expires 2027-01-05.
- **MAIL-001** (email OTP transport, ADR-025) is specified and unstarted. Email OTP currently runs
  through the mock adapter outside production.

## How to work here

- `node scripts/checkpoint-verify.mjs` is the gate. It is the only verdict that counts, and it takes
  roughly 25 minutes. Run it on a clean tree.
- `node scripts/test/run-integration.mjs <paths>` for a targeted integration run; it runs both
  MariaDB 10.6 and 11.8, and both must pass.
- `pnpm install --ignore-scripts` when the Prisma schema has not changed, because the engine DLL is
  often locked by a concurrent test worker on Windows.
- Migrations are generated: edit `schema.prisma`, add a section marker, then
  `node scripts/migration-new.mjs <nnnn>`. Constraints live in `sql/constraints/<table>.sql` and are
  inlined at generation time.
