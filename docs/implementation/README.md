# Implementation Blueprint

This directory is the implementation contract (Stage 3, corrected and extended in **Stage 3.1** and **Stage 3.2** on 2026-09-17) for the architecture under `docs/architecture/`. It describes:
- what a coding agent must create;
- where each piece belongs;
- how components communicate;
- how to prove each phase works.

It contains no production application source.

## Authority and precedence

When documents disagree, the higher-ranked one wins:
1. The Stage 3.2 brief (SMS/OTP, payments, medicine import), then the Stage 3.1 brief.
2. ADR-018…ADR-020 and ADR-013…ADR-017 (`docs/architecture/ADR-0xx-*.md`).
3. `ARCHITECTURE-CONSISTENCY-AUDIT.md`.
4. Other documents in this directory.
5. Architecture specifications under `docs/architecture/`. These carry dated change logs where superseded.

Research authority: `teardown/COMBINED-TECHNICAL-TEARDOWN.md`. Hosting evidence: `HOSTING-VERIFICATION.md`. AI provider evidence: `AI-PROVIDER-REGISTER.md`. SMS evidence: `ZAMANIT-VERIFICATION.md`. Payment gateway evidence: `AAMARPAY-VERIFICATION.md`. Medicine data: `tools/medicine-data/dist/<version>/DATASET-CARD.md`.

This package keeps uncertainty explicit wherever provider, legal, clinical or runtime validation is still required. It makes **no legal or regulatory compliance claim**.

## Reading order

1. `STAGE-3.2-CHANGELOG.md` and `STAGE-3.1-CHANGELOG.md` (what changed and why), then `ARCHITECTURE-CONSISTENCY-AUDIT.md`
2. ADR-013 (hosting), ADR-014 (MariaDB), ADR-015 (DB job queue), ADR-016 (storage and scanning), ADR-017 (per-doctor AI), ADR-018 (Zaman IT SMS/OTP), ADR-019 (aamarPay payments), ADR-020 (medicine dataset import)
3. `HOSTING-VERIFICATION.md`, `AI-PROVIDER-REGISTER.md`, `ZAMANIT-VERIFICATION.md` (+ `zamanit-provider-request.md`), `AAMARPAY-VERIFICATION.md`
4. `TECHNOLOGY-STACK.md`, `REPOSITORY-STRUCTURE.md`, `MODULE-BOUNDARIES.md`
5. `DATABASE-IMPLEMENTATION.md`, `QUEUE-IMPLEMENTATION.md`, `QUEUE-CONCURRENCY-DESIGN.md`, `EVENT-ARCHITECTURE.md`
6. `API-IMPLEMENTATION.md`, `AUTH-IMPLEMENTATION.md`, `AUTHORIZATION-MATRIX.md`, `DOMAIN-SERVICE-CONTRACTS.md`
7. Capability contracts: `FILE-STORAGE-IMPLEMENTATION.md`, `PRESCRIPTION-IMPLEMENTATION.md` (incl. medicine import), `PAYMENT-IMPLEMENTATION.md`, `COMMUNICATION-IMPLEMENTATION.md` (incl. SMS), `TELEMEDICINE-IMPLEMENTATION.md`, `AI-IMPLEMENTATION.md`
8. Clients: `WEB-IMPLEMENTATION.md`, `MOBILE-IMPLEMENTATION.md`
9. Quality and operations: `SECURITY-IMPLEMENTATION.md`, `OBSERVABILITY.md`, `TEST-IMPLEMENTATION.md`, `LOCAL-DEVELOPMENT.md`, `CI-CD.md`, `DEPLOYMENT.md`
10. `SEED-DATA.md`, `ENVIRONMENT-CONTRACT.md`, `BUILD-CONTRACT.md`
11. `IMPLEMENTATION-BACKLOG.md`, `IMPLEMENTATION-REVIEW.md`

`COMBINED-IMPLEMENTATION-BLUEPRINT.md` is a generated concatenation of this directory, for single-file reading.

## Contract rules

- **Naming:** follow the resolved names in the consistency audit.
- **Domain model:**
  - `Serial`, not `Appointment`, is the queue unit.
  - `Encounter`, not `Appointment`, owns clinical work.
  - `Prescription.clinical_status=APPROVED` is the only final clinical state. PDF rendering is independent of it.
- **Tenant isolation:** every sensitive query is tenant-scoped in service and repository layers, with composite tenant foreign keys.
- **Infrastructure:**
  - Database: MariaDB only (ADR-014).
  - Jobs: the database queue only (ADR-015).
  - Files: the storage port only (ADR-016).
  - Live updates: polling only, with no inbound WebSockets (ADR-013).
- **Providers (Stage 3.2):**
  - SMS through `SmsProvider` with POST only (ADR-018);
  - payments are marked paid only after gateway verification, with server-computed amounts (ADR-019);
  - medicines only from verified-checksum Stage M datasets, never as dosing guidance (ADR-020);
  - production gates `GATE-SMS-HTTP`, `GATE-PAY-PLATFORM-COLLECTION` and `GATE-MEDDATA-PROD` (`IMPLEMENTATION-REVIEW.md` §4).
- **AI:**
  - Credentials belong to doctors and are never readable.
  - Data-use policy is encoded from adapter metadata.
  - AI never writes final clinical data without explicit doctor approval (ADR-008, ADR-017).
- **Reference repositories** are read-only research inputs. No source code is copied or forked.
- **Data:** synthetic patient, clinical, payment and account data only in local, test, demo and staging environments. The non-patient reference medicine catalog (Stage M dataset) may be imported in dev and staging (ADR-020).

## Start of Stage 4

Run HOST-001…HOST-013 on the real plan in parallel with FOUND-001… (`IMPLEMENTATION-BACKLOG.md` Phase 0 and 1). Record results in `HOSTING-VERIFICATION.md`.
