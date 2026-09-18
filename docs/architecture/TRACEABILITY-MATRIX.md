# Traceability Matrix

| Teardown finding | Product requirement | Architecture decision/domain | Database model | API/security | Phase |
|---|---|---|---|---|---|
| No reference has Bangladesh serial/chamber queue | Walk-in, advance, physical/remote shared queue | ADR-005; Serial & Queue | `chamber_days`, `serials`, `check_ins`, `queue_events` | Queue transition endpoints, concurrency/idempotency, queue audit | 3 |
| TPT has tenant-scoped EHR boundaries | SaaS tenant isolation and longitudinal records | ADR-004; Tenant/Patient/Clinical | `tenants`, memberships, patient/clinical tables | Service/repository tenant checks; cross-tenant tests | 1-2 |
| OpenEMR has mature relational clinical model | Structured clinical records and history | ADR-003/006; Clinical/Timeline | encounters, symptoms, diagnoses, prescriptions, labs, timeline | Source-linked history and PHI audit | 4-6 |
| HCW has consultation/media state patterns | Physical and remote consultation in one encounter | ADR-012; Encounter/Telemedicine | `encounters`, sessions, participants | Session token authorization, reconnect, no recording default | 4/8 |
| Medigo has patient/doctor mobile split | Android-first role-specific apps with shared primitives | ADR-011; Mobile | API-backed domain tables, upload status | OAuth/OTP, offline-safe outbox, no direct DB writes | 10 |
| Medigo stores free-text prescription/report artifacts | Structured searchable prescription and labs | ADR-003; Prescription/Lab | `prescriptions`, `prescription_items`, `lab_reports`, `lab_results` | Approval/finalization and versioning | 5 |
| No reference has verified AI/voice | Assistive draft only | ADR-008; AI | `ai_jobs`, transcripts, drafts, suggestions, approvals | Doctor-only approval, provenance, redacted logs | 9 |
| WhatsApp/SMS references are hooks, not verified workflows | Provider-neutral, consented, retryable delivery | ADR-007; Communication | `communications`, attempts, preferences | Adapter/webhook/idempotency contracts | 7-8 |
| No Bangladesh medicine catalog verified | Import-ready localized medicine search | New design; Localization/Medication | `medications`, aliases, dataset version | Search API with source/version and free-text fallback | 5/V1 |
| Low bandwidth/offline not proven | Android low-bandwidth and resumable workflow | ADR-009/011; Mobile/Storage | document/upload metadata and statuses | Resumable upload, stale queue labeling, audio fallback | 8/10 |
| OpenEMR GPL; Medigo/HCW rights unknown | New codebase with legal boundaries | ADR-001; all contexts | No copied schema/source | Dependency SBOM and legal review register | 0/11 |
| Audit maturity varies; Medigo lacks audit | Clinical and PHI access auditability | Security spec; Audit | `audit_logs`, immutable versions | Audit on read/write/approval/export/access | 1-12 |
| No reference proves local payments | Provider-neutral future payment support | New design; Billing | `billing_accounts`, `payment_intents` deferred | Adapter boundary, no provider commitment | Future |
| No regulatory conclusions in teardown | Research register before production | Security/localization/open questions | Policy/config tables, not invented rules | Legal/regulatory review gate | 11-12 |

## Coverage checks

- Serial engine: Product, Domain, Database, API, Mobile, Roadmap, ADR-005.
- Patient identity and deduplication: Product, Domain, Database, API, Security, Phase 2.
- Timeline: Product, Domain, Database, API, ADR-006, Phase 6.
- Consultation/encounter separation: Product, Domain, Database, API, Telemedicine, Phase 4/8.
- Prescription approval: Domain, Database, API, AI, Security, Phase 5/9.
- Provider-neutral communication: Communication, System, API, ADR-007, Phase 7/8.
- AI human approval: AI, Security, API, ADR-008, Traceability, Phase 9.
- Bangladesh localization: Localization, Mobile, Communication, Product, Roadmap, Phase 5/8/10.
- Licensing/uncertainty: README, Product, ADR-001, Security, roadmap gate.

## Change log

### 2026-09-17 — Stage 3.1

- Rows about the relational engine, the job queue and signed URLs map to ADR-014, ADR-015 and ADR-016 respectively; AI rows additionally map to ADR-017.

### 2026-09-17 — Stage 3.2

- The row "No reference proves local payments → provider-neutral future payment support (`billing_accounts`, `payment_intents` deferred)" is superseded by ADR-019: `payment_intents` and related tables are MVP behind `PaymentGatewayPort` with the aamarPay adapter. Communication rows map to ADR-018 for SMS; medication catalog rows map to ADR-020.
