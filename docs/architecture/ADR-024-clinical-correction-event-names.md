# ADR-024 — Correction and withdrawal get their own event names

**Status:** Accepted (2026-09-24, Stage 7)
**Resolves:** audit row C-53.
**Amends:** `EVENT-ARCHITECTURE.md` §4 (event names v1).

## Context

Every clinical artefact in this system can be corrected and can be withdrawn, and neither destroys what
came before. A note is amended by signing a new revision with a reason. A diagnosis is voided with a
reason and replaced. A prescription is corrected by approving a new revision, which voids the one it
supersedes in the same transaction.

The event catalogue does not treat these three the same way:

| Artefact | Created | Corrected | Withdrawn |
|---|---|---|---|
| Encounter note | `EncounterNoteSigned` | *no name* | *no name* |
| Diagnosis | `DiagnosisRecorded` | *no name* | `DiagnosisStatusChanged` |
| Prescription | `PrescriptionApproved` | *no name* | **`PrescriptionVoided`** |

Prescriptions already have a distinct name for withdrawal; diagnoses fold withdrawal into a general
status change; notes have nothing for either. Stage 6 shipped `EncounterNoteSigned` carrying
`revision` and `amended` in its payload, and recorded the gap rather than inventing a name (C-53).

Stage 7 adds prescription corrections, which would hit the same question a third time. It is decided
once here, for all three.

## Decision

**A correction and a withdrawal each get their own event name.** The catalogue gains:

- `EncounterNoteAmended` — a signed revision after the first, carrying its reason.
- `DiagnosisVoided` — a diagnosis withdrawn with a reason.

`PrescriptionVoided` already exists and is unchanged. A prescription correction emits `PrescriptionVoided`
for the superseded revision and `PrescriptionApproved` for the new one, in that order, in one
transaction — it needs no third name, because it genuinely is both of those things happening.

`DiagnosisStatusChanged` stays, for the status moves that are not withdrawals (`ACTIVE → RESOLVED`,
`ACTIVE → RULED_OUT`). A void emits `DiagnosisVoided` instead of, not in addition to, a status change.

Payloads keep their discriminators (`revision`, `amended`, `voided`). The name is the contract; the
payload is the detail.

## Why not the alternative

The alternative — ratify "documented name plus a payload discriminator" as the permanent convention —
is cheaper. It adds no names and Stage 6 already works that way.

It was rejected because of how each option fails.

With a discriminator, a consumer that ignores the flag renders an amendment as an original signature.
A patient's timeline would show a doctor's first account of a visit where the corrected one belongs, and
nothing anywhere would report an error: the event was valid, the handler ran, the output is wrong. For a
clinical record, "the correction was silently displayed as the original" is close to the worst failure
this system could have, and it would be found by a person noticing, not by a test.

With distinct names, a consumer that has not been taught the new name receives an event it does not
recognise. That is a loud failure — an unhandled event type, visible in the projector's own error
counters — and it fails in the direction of showing nothing rather than showing the wrong thing.

A name is a contract that a consumer must handle. A flag is a detail a consumer may overlook. Where the
difference is "is this what the doctor originally wrote, or the correction", that must be a contract.

## Consequences

- Positive: the timeline projector, when it arrives in Stage 11, can route on the name alone. A correction
  cannot be mistaken for an original by omission.
- Positive: the catalogue becomes self-consistent. Prescriptions already worked this way.
- Negative: two more names, and Stage 6's `EncounterNoteSigned` consumers must learn one of them. Nothing
  consumes these events yet — the projector is Stage 11 — so the cost is paid now rather than later.
- Neutral: the payload discriminators stay. They are useful, and removing them would break nothing but
  would also help nothing.

## Applying it

- `EVENT-ARCHITECTURE.md` §4 lists both new names under **Clinical**.
- `packages/clinical` emits `EncounterNoteAmended` for revision ≥ 2 and `DiagnosisVoided` on a void.
- `packages/prescriptions` emits `PrescriptionVoided` then `PrescriptionApproved` for a correction.
- The mandatory event tests assert the name, not only the payload.
