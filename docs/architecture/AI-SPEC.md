# AI Assistance Specification

## 1. Safety boundary

AI is assistive software, never the clinical authority. It MUST NOT silently diagnose, prescribe, modify a patient record, finalize a prescription, or overwrite doctor documentation.

The required flow is:

```text
RAW INPUT -> AI PROCESSING -> AI DRAFT -> REVIEW REQUIRED
-> DOCTOR EDITED -> DOCTOR APPROVED -> FINAL CLINICAL RECORD
```

## 2. Provider abstraction

Define an `AIProvider` interface with operations such as:

- `transcribe(audio_reference, language_hints)`;
- `draft_note(transcript_or_selected_notes, patient_context_reference)`;
- `extract_clinical_items(note_reference)`;
- `retrieve_history(patient_id, query)`;
- `summarize_timeline(patient_id, date_range)`;
- `suggest_follow_up(encounter_reference)`.

The domain stores provider, model, version, request ID, timestamps, schema version, and status. No business module imports a specific vendor SDK directly.

## 3. MVP AI scope

### MVP

- Doctor-triggered patient history retrieval with source timeline references.
- Draft clinical note from doctor-selected structured inputs and free-text notes.
- Optional asynchronous audio upload for transcription only if a reviewed provider is available.
- Structured draft sections: complaint, history, observed symptoms, assessment candidates, plan candidates, and missing-information prompts.
- Doctor review screen with accept/edit/reject per suggestion.

### V1/V2

- Bangla, English, and mixed Banglish transcription evaluation.
- Clinical extraction into candidate symptoms/diagnoses/medications.
- Draft prescription items that require explicit item-by-item approval.
- Lab report assistance that never replaces the raw report.
- Similar prior encounters with source links.

### Future/research

- Real-time transcription, automated coding, medication safety recommendations, continuous ambient capture, and advanced decision support. These require clinical validation, provider review, and legal/regulatory research.

## 4. Data and provenance

Every `AIJob`, `AITranscript`, `AIDraft`, `AISuggestion`, and `AIApproval` MUST record:

- tenant, actor, patient/encounter reference;
- provider/model/version and schema version;
- input references, selected history range, and timestamp;
- raw output stored in protected redacted storage;
- structured validated output;
- confidence/uncertainty where provider supports it;
- review status and reviewer;
- edits, decision, approval timestamp, final artifact reference;
- correlation ID and audit event.

No AI output becomes a diagnosis or prescription merely because it passes schema validation.

## 5. Human review UX contract

- Display “AI draft” and “Review required” prominently.
- Show source references for every extracted item.
- Permit accept, edit, reject, and ignore-later actions.
- Require doctor attestation before final clinical save.
- Make AI-generated text visually distinguishable until approved.
- Do not allow a bulk “approve all” for diagnosis or prescription without item-level confirmation in MVP.
- Preserve the final doctor-authored version separately from the AI draft.

## 6. Voice pipeline

```text
Audio capture -> resumable upload -> malware/format check -> transcription job
-> transcript -> clinical extraction job -> draft -> doctor review -> approval
```

- MVP may be asynchronous; real-time transcription is not required.
- Support language hints `bn`, `en`, and `mixed` without assuming quality.
- Store audio as a protected object with retention policy and explicit recording/consent state.
- Segment uploads and retry failed parts; never put audio bytes in PostgreSQL.
- Chamber noise, code-switching, accents, and medical terms require evaluation datasets that contain no real patient data unless separately approved.
- A failed AI job leaves the ordinary manual workflow available.

## 7. Retrieval design

Patient-history retrieval uses a tenant/patient authorization check before retrieval. The first implementation can query `timeline_events`, encounters, prescriptions, diagnoses, lab reports, and follow-ups with date/type filters. Retrieval results MUST include source IDs and occurred-at dates. A vector index MAY be added later, but it cannot bypass relational authorization or source citations.

## 8. Failure and safety

- Provider timeout, quota, unsafe content, schema failure, low confidence, or missing consent produces a visible failed/needs-review state.
- AI jobs are retryable with idempotency keys and bounded attempts.
- Prompt injection in uploaded documents is treated as untrusted content.
- The UI MUST allow the doctor to discard AI output and complete the consultation manually.
- Safety incidents and incorrect approved suggestions are auditable and reportable.

## Change log

### 2026-09-17 — Stage 3.1

- The single platform `AIProvider` is replaced by per-doctor credentials across providers (Gemini API, OpenAI-compatible endpoints, mock), with billing modes `DOCTOR_BYOK_FREE`, `DOCTOR_BYOK_PAID` and a disabled `PLATFORM_MANAGED` (ADR-017).
- The approval architecture (ADR-008) is unchanged: AI output stays a draft or suggestion, and only doctor approval inside the clinical context writes records.
- Transcription remains disabled for MVP. The rule about audio bytes now reads "never put audio bytes in the database" (MariaDB, ADR-014); raw media is never sent to providers that may train on inputs.
- Provider terms for clinical use (notably Gemini API) are recorded as OPEN production gates in `docs/implementation/AI-PROVIDER-REGISTER.md` (audit C-02).
