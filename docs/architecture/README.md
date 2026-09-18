# Architecture Package

This directory is the implementation-ready architecture baseline for the new Bangladesh-first Doctor Telemedicine and Patient Continuity Platform.

## Authority and scope

The design is based on `teardown/COMBINED-TECHNICAL-TEARDOWN.md`. The reference repositories are research inputs only. This package does not copy source code, fork a repository, or claim that any unverified reference behavior is production-ready.

The architecture separates observed evidence from new design:

- **Observed:** facts verified in the teardown.
- **Adopted pattern:** an architectural idea retained from a reference.
- **New design:** a product decision created for this platform.
- **Open question:** requires validation, provider selection, clinical review, or legal/regulatory research.

## Reading order

1. `PRODUCT-ARCHITECTURE-SPEC.md` defines product scope, bounded contexts, workflows, and MVP boundaries.
2. `SYSTEM-ARCHITECTURE.md` defines runtime components, deployment, synchronous/asynchronous boundaries, storage, and observability.
3. `DOMAIN-MODEL.md` defines domain entities and state machines.
4. `DATABASE-SPEC.md` turns the domain model into relational tables, constraints, indexes, and retention rules.
5. `API-SPEC.md` defines REST contracts and authorization boundaries.
6. `SECURITY-SPEC.md` defines identity, tenant isolation, PHI controls, audit, and operational security.
7. `COMMUNICATION-SPEC.md` defines WhatsApp/SMS/email/phone/video adapters and delivery semantics.
8. `AI-SPEC.md` defines assistive AI, provenance, approval, voice, and retrieval boundaries.
9. `MOBILE-SPEC.md` defines doctor and patient Android-first clients.
10. `BANGLADESH-LOCALIZATION-SPEC.md` defines phone, language, medicine, timezone, connectivity, and chamber localization.
11. `IMPLEMENTATION-ROADMAP.md` defines dependency-aware delivery phases and acceptance criteria.
12. `ARCHITECTURE-DECISIONS.md` records the major decisions and alternatives, with an index.
    - `ADR-013-hostinger-hosting.md` … `ADR-017-per-doctor-multi-provider-ai.md` (Stage 3.1) supersede parts of ADR-003, ADR-009 and ADR-010 and extend ADR-008. `ADR-018-zamanit-sms-otp.md`, `ADR-019-aamarpay-payments-mvp.md` and `ADR-020-medicine-dataset-import.md` (Stage 3.2) extend ADR-007 and supersede the billing-Future scope. Where an ADR and a specification disagree, the ADR wins; affected specifications carry a dated change log.
13. `TRACEABILITY-MATRIX.md` maps teardown findings to requirements, models, APIs, security controls, and phases.
14. `ARCHITECTURE-REVIEW.md` is the final consistency and risk review for this stage.

## Normative language

- **MUST:** required for the architecture baseline.
- **SHOULD:** recommended unless a documented decision changes it.
- **MAY:** optional and non-blocking.
- **MVP/V1/V2/Future:** delivery boundaries, not a promise of implementation in this stage.

## Product loop

`Patient identity -> booking or walk-in serial -> shared chamber queue -> consultation/encounter -> doctor-approved prescription and notes -> patient timeline -> follow-up serial`

Physical and remote patients use the same appointment, serial, encounter, timeline, and follow-up domains. The access channel changes; the clinical identity does not.

## Change log

### 2026-09-17 — Stage 3.1

- Added ADR-013…ADR-017 and change-log entries in SYSTEM-ARCHITECTURE, DATABASE-SPEC, API-SPEC, SECURITY-SPEC, AI-SPEC, DOMAIN-MODEL, BANGLADESH-LOCALIZATION-SPEC, IMPLEMENTATION-ROADMAP, COMMUNICATION-SPEC, MOBILE-SPEC, PRODUCT-ARCHITECTURE-SPEC, ARCHITECTURE-REVIEW and TRACEABILITY-MATRIX. Original specification text is not rewritten.

### 2026-09-17 — Stage 3.2

- Added ADR-018 (Zaman IT SMS/OTP), ADR-019 (aamarPay payments MVP; supersedes billing-Future) and ADR-020 (medicine dataset import), and Stage 3.2 change-log entries in SYSTEM-ARCHITECTURE, DATABASE-SPEC, API-SPEC, SECURITY-SPEC, COMMUNICATION-SPEC, PRODUCT-ARCHITECTURE-SPEC, BANGLADESH-LOCALIZATION-SPEC, DOMAIN-MODEL, MOBILE-SPEC, IMPLEMENTATION-ROADMAP, ARCHITECTURE-REVIEW and TRACEABILITY-MATRIX. Original specification text is not rewritten.
