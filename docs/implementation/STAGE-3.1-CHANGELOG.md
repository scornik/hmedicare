# Stage 3.1 Changelog — Blueprint Correction, Hostinger Hosting Target & Per-Doctor Multi-Provider AI

**Date:** 2026-09-17. **Scope:** `docs/architecture/` (new ADRs, index, dated change logs) and `docs/implementation/` (rewrites). No production source code was written, no reference repository was modified, and no compliance claim is made.

## 1. Why

1. **Hosting target is Hostinger Cloud Startup.** Verification (`HOSTING-VERIFICATION.md`) found constraints that break the Stage 3 design:
   - MariaDB only, with no PostgreSQL or Redis;
   - Node apps stop when idle;
   - no inbound WebSockets;
   - deploy directories are overwritten on every deployment;
   - 4 CPU / 4 GB of resources shared across the plan.
2. **AI ownership moves from one platform provider to per-doctor credentials** across multiple providers, including free tiers whose terms permit training or human review.
3. **Stage 3 contained internal contradictions** that would force a coding agent to invent decisions. They are recorded as audit rows C-04…C-20.

## 2. ADRs created

| ADR | Decision | Supersedes / extends |
|---|---|---|
| ADR-013 Hostinger hosting | `api`, `worker` and static `app` sites plus staging; cron keep-alive; polling; memory, connection and scale budgets; VPS migration path | Extends SYSTEM-ARCHITECTURE deployment |
| ADR-014 MariaDB engine | 10.6 feature floor; translation table; no triggers; hash chains; `lockRow`; composite tenant FKs | Supersedes ADR-003 engine choice; withdraws the RLS option (ADR-004) |
| ADR-015 Database job queue | jobs/leases/dead letters/singletons; outbox → jobs; runner modes; DB rate limits, OTP and idempotency | Decides ADR-010 queue technology; removes Redis/BullMQ |
| ADR-016 Object storage and scanning | `ObjectStoragePort` (S3-compatible, private disk); HMAC download tokens; `MalwareScanPort` | Partially supersedes ADR-009 |
| ADR-017 Per-doctor multi-provider AI | billing modes; encoded data-use policy; envelope encryption; adapters; minimization; provider production gates | Extends ADR-008 (approval unchanged); replaces AI-SPEC single provider |

## 3. Documents

### 3.1 Architecture (index and change logs only)

- `ARCHITECTURE-DECISIONS.md`: index table plus supersession notes on ADR-003, ADR-004, ADR-008, ADR-009 and ADR-010. The original ADR text is unchanged.
- Dated "Change log — 2026-09-17 Stage 3.1" sections were appended to:
  - SYSTEM-ARCHITECTURE, DATABASE-SPEC, API-SPEC, SECURITY-SPEC, AI-SPEC, DOMAIN-MODEL;
  - BANGLADESH-LOCALIZATION-SPEC (research register additions: Hostinger region, storage/backup region, AI provider location and terms, AI patient data gate);
  - IMPLEMENTATION-ROADMAP, COMMUNICATION-SPEC, MOBILE-SPEC, PRODUCT-ARCHITECTURE-SPEC, ARCHITECTURE-REVIEW, TRACEABILITY-MATRIX, README.
- `COMBINED-ARCHITECTURE-SPEC.md` was regenerated and now includes ADR-013…017.

### 3.2 Implementation

| Document | Change |
|---|---|
| HOSTING-VERIFICATION.md | **New.** 28 facts with status/default/fallback, sources, engine probes (10.6.28, 11.4.13), toolchain verification, HOST-001…013 |
| AI-PROVIDER-REGISTER.md | **New.** Normative provider metadata (mock ×2, Gemini free/paid, OpenAI, Groq, Mistral, OpenRouter, DeepSeek, Anthropic), clause evidence, AIREG-001…009 gates |
| STAGE-3.1-CHANGELOG.md | **New** (this file) |
| ARCHITECTURE-CONSISTENCY-AUDIT.md | Rewritten: precedence, C-01…C-20, Stage 3 rows S3-01…S3-13 with amendments, external decisions with default and proving task |
| TECHNOLOGY-STACK.md | Rewritten: exact pins, one choice per concern, removed list |
| REPOSITORY-STRUCTURE.md | Rewritten: per-context layers, kernel, adapter packages, `mobile/` workspace, exact dependency-cruiser config (C-13) |
| MODULE-BOUNDARIES.md, EVENT-ARCHITECTURE.md, DOMAIN-SERVICE-CONTRACTS.md | Rewritten for DB outbox/jobs, new contexts, AI ownership |
| DATABASE-IMPLEMENTATION.md | Rewritten for MariaDB: type conventions, migrations 0001–0014, all tables, generated uniques, composite FKs, hash chains, TTL jobs (C-04…C-08, C-10, C-11, C-15) |
| QUEUE-IMPLEMENTATION.md, QUEUE-CONCURRENCY-DESIGN.md | Rewritten: complete state machine, version split, MariaDB locking diagrams and tests (C-04, C-07, C-08) |
| API-IMPLEMENTATION.md | Rewritten: full endpoint matrix, unified uploads, canonical errors (C-12) |
| AUTH-IMPLEMENTATION.md | Rewritten: DB-backed OTP/sessions, synchronous OTP delivery, web cookie + CSRF |
| AUTHORIZATION-MATRIX.md | Rewritten: permission catalog, role map constant, assigned doctor, patient contexts (C-14…C-16) |
| FILE-STORAGE-IMPLEMENTATION.md | Rewritten for ADR-016 |
| PRESCRIPTION-IMPLEMENTATION.md | Rewritten: `REVIEWED` semantics, revision vs row_version (C-06, C-11) |
| AI-IMPLEMENTATION.md | Rewritten for ADR-017: credentials lifecycle, policy/ack/consent, minimization, jobs/drafts/suggestions, approval in clinical |
| COMMUNICATION-IMPLEMENTATION.md, TELEMEDICINE-IMPLEMENTATION.md | Updated: DB job queue, synchronous OTP, provider-hosted signaling, polling |
| WEB-IMPLEMENTATION.md, MOBILE-IMPLEMENTATION.md | Rewritten: polling, in-memory token + cookie (web), `mobile/` workspace, patient contexts, AI credential UI |
| SECURITY-IMPLEMENTATION.md | Rewritten: threats T1–T17 |
| OBSERVABILITY.md | Rewritten: stdout JSON, redaction patterns, job-lag metrics, alerts |
| TEST-IMPLEMENTATION.md, SEED-DATA.md, LOCAL-DEVELOPMENT.md | Rewritten: MariaDB/MinIO/mock-providers, engine-contract suite, synthetic seeds, two mock AI rows |
| ENVIRONMENT-CONTRACT.md | Rewritten: REQ-PROD/OPT/LOCAL per app, removed variables |
| CI-CD.md, DEPLOYMENT.md, BUILD-CONTRACT.md | Rewritten: Hostinger GitHub deploy, guarded migrations, backups/restore drill, key rotation, build rules |
| IMPLEMENTATION-BACKLOG.md | Re-sequenced: HOST-001…013, FOUND-001…013, JOB-001…008, ID, PAT-001…008 (PAT-006 accounts, PAT-007 guardianship, PAT-008 care team), QUEUE, CLIN, DOC, RX, TL/FUP, COM/TELE, AICRED-001…005, AIPOL-001…004, ADAPT-001…004, AI-001…003, WEB, MOB, SEC, OPS, RELEASE. Redis/BullMQ tasks removed |
| IMPLEMENTATION-REVIEW.md | Rewritten: readiness gate answers, UNVERIFIED → task map, production gates |
| README.md | Rewritten: precedence, reading order incl. new documents |
| COMBINED-IMPLEMENTATION-BLUEPRINT.md | Regenerated |

## 4. Self-consistency sweep

Command (run from `docs/`, case-insensitive fixed strings, all `*.md` in `architecture/` and `implementation/`): one `grep -rniF` per term. Terms: `Redis`, `BullMQ`, `PostgreSQL`, `jsonb`, `timestamptz`, `citext`, `gen_random_uuid`, `partial unique`, `RLS`, `Vitest/Jest`, `Biome or`, `or equivalent`, `MAY be added`, `make `, bare `version` columns, `doctor.review_ai`, `doctor.approve_ai`, `lab-reports/upload-session`.

**Result: no remaining occurrence prescribes a superseded construct.** Every remaining occurrence is intentional and falls into one of the categories below. The two `COMBINED-*` files mirror their sources and contain the same occurrences, so they are not listed separately. The same applies to this changelog and to `IMPLEMENTATION-REVIEW.md` §2: the readiness-gate questions and answers quote Redis, PostgreSQL, `jsonb`, `timestamptz`, `citext` and partial uniques while confirming that they were removed or translated.

| Term | Remaining occurrences | Why intentional |
|---|---|---|
| Redis, BullMQ | audit C-03; AUTH-IMPLEMENTATION, COMMUNICATION-IMPLEMENTATION, EVENT-ARCHITECTURE, LOCAL-DEVELOPMENT headers ("no Redis"); BUILD-CONTRACT MUST NOT; ENVIRONMENT-CONTRACT removed-variables list (`REDIS_URL`); HOSTING-VERIFICATION #27 and sources; IMPLEMENTATION-BACKLOG "Removed"; TECHNOLOGY-STACK removed list; ADR-013 (host facts, rejected alternative, VPS migration option); ADR-015 (context, replacement table, rejected alternatives, port neutrality); SYSTEM-ARCHITECTURE original §storage line + change log | Removal records, prohibitions, verified host facts, rejected alternatives, original architecture text superseded by a dated change log |
| PostgreSQL | audit C-08; BUILD-CONTRACT MUST NOT; HOSTING-VERIFICATION #27 and sources; LOCAL-DEVELOPMENT header; TECHNOLOGY-STACK removed list; ADR-013/014/015 (facts, translation table, rejected escape hatch); ARCHITECTURE-DECISIONS ADR-003/009 original text + index/notes; original text in AI-SPEC, ARCHITECTURE-REVIEW, DATABASE-SPEC, IMPLEMENTATION-ROADMAP, PRODUCT-ARCHITECTURE-SPEC, SYSTEM-ARCHITECTURE (each with a Stage 3.1 change log) | Same categories |
| jsonb, timestamptz, citext, gen_random_uuid, partial unique | ADR-014 translation table; TECHNOLOGY-STACK removed list; audit C-08; original DATABASE-SPEC text (change log) | Translation records and superseded original text |
| RLS | ADR-014 translation table; ARCHITECTURE-DECISIONS ADR-003 original open question + index/notes; DATABASE-SPEC change log. (A case-insensitive search also matches "URLs"; those are not RLS mentions.) | Withdrawal records |
| Vitest/Jest, Biome or, or equivalent | TECHNOLOGY-STACK "replaced choices" table and header; audit C-20; ADR-015 supersedes line; SYSTEM-ARCHITECTURE original line + change log | Records of removed alternatives |
| MAY be added | DATABASE-SPEC original RLS clause (withdrawn by change log); AI-SPEC "A vector index MAY be added later" | RLS clause superseded; the vector-index clause is an unrelated, still-valid Future option |
| `make ` | LOCAL-DEVELOPMENT (optional Makefile that only wraps pnpm scripts one-to-one); ordinary English "make" in API-IMPLEMENTATION, BUILD-CONTRACT, AI-SPEC, ARCHITECTURE-DECISIONS | Not a build dependency |
| bare `version` columns | none. Remaining `version` words: DATABASE-IMPLEMENTATION rule "No table has a bare column named `version`"; audit C-04/C-06 records; `/health/live` response field `version` (API, DEPLOYMENT, OBSERVABILITY); prompt front-matter `version` (AI-IMPLEMENTATION); `policy_version`, `role_permissions_version` (named business versions) | Not optimistic-lock columns |
| doctor.review_ai, doctor.approve_ai | AUTHORIZATION-MATRIX removal note; original API-SPEC rows (change log) | Removal record and superseded original text |
| lab-reports/upload-session | API-IMPLEMENTATION removal note; audit C-12; original API-SPEC row (change log) | Same |

## 5. Items deliberately left UNVERIFIED

See `IMPLEMENTATION-REVIEW.md` §3 (Hostinger facts → HOST tasks) and `AI-PROVIDER-REGISTER.md` (AIREG-001…009). None blocks the start of Stage 4.
