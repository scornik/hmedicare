# Authorization Matrix

**Stage 3.1 rewrite (2026-09-17).** Adds the permission catalog, the role→permission source of truth, the definition of "assigned doctor", patient contexts (accounts, guardianship), care teams, covering doctors, and AI credential/policy permissions. Resolves audit rows C-14 … C-16.

**Stage 3.2 update (2026-09-17):**
- payment, fee, merchant, refund and SMS-credential permissions (ADR-018/019);
- guardian scope `MAKE_PAYMENTS`;
- **`platform_operator`** as an explicit, minimal, audited role outside tenant roles (§1.1, §5.1);
- `ROLE_PERMISSIONS_VERSION` bumped to **2**.

## 1. Sources of permission

1. **Role → permission map.** A versioned code constant in `packages/identity-access/src/domain/authz/role-permissions.ts`:
   ```ts
   export const ROLE_PERMISSIONS_VERSION = 2; // Stage 3.2: payments, fees, merchants, refunds, SMS credentials
   export const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = { … };
   ```
   Changing it bumps `ROLE_PERMISSIONS_VERSION`, requires an ADR or audit row, and must pass the matrix test (§7). Audit events record the version used for each decision.
2. **Explicit grants and denials.** `tenant_memberships.permissions` is `JSON {"grants": Permission[], "denials": Permission[]}`. It holds **only** additions and removals on top of the role map. It is validated against the permission catalog on write, and audited (`membership.permissions_changed`).
3. **Effective permissions:**
   ```text
   effective = (ROLE_PERMISSIONS[role] ∪ grants) − denials
   ```
   Computed by the `PolicyEngine`. Denials always win.
4. **Resource scope.** A permission is necessary but never sufficient. Each use case also checks tenant, clinic/chamber scope, assignment (§3) or patient context (§4).

Staff roles (`tenant_memberships.role`): `tenant_owner`, `clinic_admin`, `doctor`, `nurse`, `receptionist`, `billing_manager`.
Patient users are **not** tenant members. They act through a **patient context** (§4). The `patient` column below describes that context.
### 1.1 Platform operator (Stage 3.2)

`platform_operator` is **not** a tenant role, and never appears in `tenant_memberships`.
- **Definition:** an `ACTIVE` `platform_operators` row (`DATABASE-IMPLEMENTATION.md` §3.15) holding an explicit subset of the **platform permission catalog** (§2). There is no implicit superuser, and no platform permission grants tenant data access.
- **Authentication:** password + OTP per session, `X-Platform-Context: operator`, short idle timeout (`AUTH-IMPLEMENTATION.md` §2.6).
- **Audit:** every platform request and every grant or revoke is written to the platform audit chain (`actor_type=OPERATOR`).
- **Minimal defaults:** the first operator receives only the permissions named on the CLI. Recommended sets:
  - *ops*: `ops.jobs.replay`, `ops.metrics.read`, `ops.sms.read`;
  - *catalog*: `medication.import`;
  - *finance*: `payout.manage`, `platform.refund.manage`;
  - *admin*: `platform.tenants.bootstrap`, `platform.operators.manage`, `ops.backup.restore_drill`.
- **Separation:** a user may hold both a tenant membership and an operator row, but a single request uses one context. Gate decisions are **not** an operator permission: they are CLI-only with DB access (API-IMPLEMENTATION §3.12).

## 2. Permission catalog

| Group | Permissions |
|---|---|
| Tenant/org | `tenant.manage`, `membership.manage`, `clinic.manage`, `chamber.manage`, `schedule.manage`, `coverage.manage` |
| Patient | `patient.read`, `patient.write`, `patient.merge`, `patient_account.manage`, `guardianship.manage`, `care_team.manage` |
| Scheduling/queue | `appointment.read`, `appointment.write`, `serial.write`, `serial.manage`, `queue.read`, `queue.call`, `queue.manage`, `chamber_day.close` |
| Clinical | `encounter.read`, `encounter.start`, `encounter.manage`, `encounter.complete`, `note.write`, `note.sign`, `clinical.write`, `diagnosis.write` |
| Prescription | `prescription.read`, `prescription.write`, `prescription.review`, `prescription.approve`, `prescription.render`, `prescription.void` |
| Labs/documents | `lab.write`, `lab.review`, `document.read`, `document.write` |
| Timeline/follow-up | `timeline.read`, `followup.write` |
| Communication/telemedicine | `communication.send`, `communication.read`, `communication.retry`, `telemedicine.start`, `telemedicine.join`, `telemedicine.manage` |
| AI | `ai.use`, `ai.review`, `ai.approve`, `ai.credentials.manage`, `ai.policy.read`, `ai.policy.manage`, `ai.usage.read`, `ai.audit.raw_read` |
| Audit/export | `audit.read`, `export.create` |
| Payments (Stage 3.2) | `payment.create`, `payment.read`, `payment.merchant.manage`, `fee.manage`, `refund.manage` |
| SMS (Stage 3.2) | `sms.credentials.manage` |
| **Platform catalog** (operators only; never grantable to tenant memberships; validated separately) | `platform.tenants.bootstrap`, `platform.operators.manage`, `ops.jobs.replay`, `ops.backup.restore_drill`, `ops.metrics.read`, `ops.sms.read`, `medication.import`, `payout.manage`, `platform.refund.manage` |

The Stage 3.2 brief's `refund.manage` exists in both scopes: the tenant `refund.manage` covers `DOCTOR_MERCHANT` intents of that tenant, and the platform permission is named `platform.refund.manage` to keep catalogs disjoint (`PLATFORM_MERCHANT` intents).

The removed aliases `doctor.review_ai`, `doctor.approve_ai` and `ai.review` as a doctor-only alias are **not** permissions. The canonical names are `ai.review` and `ai.approve`, and doctor-only approval is a scope rule (§3).

## 3. Assigned doctor

A doctor (a `doctor_profiles` row in the tenant) is **assigned to a patient** if at least one of these holds at decision time:

1. **Encounter:** there is an encounter (active or past, any status except `ENTERED_IN_ERROR`) with `encounters.doctor_profile_id = doctor` and `encounters.patient_id = patient`.
2. **Serial/appointment:** there is a serial or appointment for the patient in a chamber whose `chambers.doctor_profile_id = doctor`, in any status.
3. **Care team:** there is an active `care_team_members` row `(tenant_id, patient_id, member_user_id, role='DOCTOR')` whose `starts_at <= now < ends_at` (or `ends_at` is null).
4. **Coverage:** there is an active `doctor_coverages` row `(tenant_id, covered_doctor_profile_id, covering_doctor_profile_id)` whose `starts_at <= now < ends_at`, and the covered doctor is assigned by rules 1–3. Coverage is not transitive.
5. **Solo-doctor tenant:** `tenants.practice_type = 'SOLO'` and the doctor is the tenant's owner doctor (`tenants.owner_doctor_profile_id`). This doctor is assigned to all tenant patients.

**Assigned to an encounter** means the encounter's own doctor, or a doctor covering that doctor under rule 4, or the solo owner doctor. Approval actions (`prescription.approve`, `ai.approve`, `note.sign`) require assignment to the **encounter**. Patient-level assignment is not enough.

The rule is implemented once, in `AssignmentPolicy.isAssignedToPatient(actor, patientId)` and `isAssignedToEncounter(actor, encounterId)`. It uses indexed queries, and in-request memoization is allowed. Results are never cached across requests.

**Nurses and staff** are not "assigned doctors". Their clinical access is: the permission, plus clinic/chamber scope (the membership's `clinic_ids`/`chamber_ids` JSON; empty means tenant-wide for `clinic_admin`/`tenant_owner` only), plus, for `nurse`, either a `care_team_members` row with role `NURSE` or the encounter being in a chamber within their scope.

## 4. Patient contexts, accounts and dependents

- **`patient_accounts`** links an authenticated `users` row to a `patients` row in a tenant: `relationship='SELF'`, `verification_method ∈ {OTP_PHONE_MATCH, STAFF_VERIFIED_IN_PERSON, STAFF_VERIFIED_DOCUMENT}`, `status ∈ {PENDING, ACTIVE, SUSPENDED, REVOKED}`.
  - OTP login alone creates **no** link.
  - A link becomes `ACTIVE` when the OTP-verified phone equals a verified `patient_contacts` phone of exactly one patient in that tenant (`OTP_PHONE_MATCH`), or when staff with `patient_account.manage` verify it.
  - If the phone matches several patients in one tenant, nothing is auto-linked, and staff must verify.
- **`patient_guardianships`** lets a user act for a dependent patient: `guardian_user_id`, optional `guardian_patient_id`, `dependent_patient_id`, `relationship` (`PARENT`, `LEGAL_GUARDIAN`, `SPOUSE`, `CHILD`, `OTHER_CAREGIVER`), `authority_scope` JSON (subset of `VIEW_RECORDS`, `BOOK_APPOINTMENTS`, `MANAGE_SERIALS`, `JOIN_TELEMEDICINE`, `UPLOAD_DOCUMENTS`, `MANAGE_COMMUNICATION_PREFERENCES`, `GIVE_CONSENT`, `MAKE_PAYMENTS` (Stage 3.2)), `verification_method`, `verified_by`, `status ∈ {PENDING, ACTIVE, ENDED, REVOKED}`, `starts_on`, `ends_on`.
  - A guardianship becomes `ACTIVE` **only** after staff with `guardianship.manage` verify it. Self-declared requests stay `PENDING`.
- **Tenant picker.** `GET /me/patient-contexts` returns every active context across tenants: `{tenantId, tenantName, patientId, patientDisplayName, relationship: 'SELF' | <guardianship relationship>, authorityScope}`. The client selects one; later requests send `X-Tenant-ID` and `X-Patient-Context: <patientId>`.
- **Profile switcher.** Within a tenant, switching between self and dependents only changes `X-Patient-Context`. No new login is needed.
- **Server enforcement on every patient-context request:**
  1. an active `patient_accounts` row (`SELF`) or an active guardianship exists for `(user, tenant, patientId)`;
  2. the guardianship `authority_scope` contains the scope required by the route (route metadata `patientScope`);
  3. `starts_on <= today(tenant tz) <= ends_on`.
  
  Failures return `FORBIDDEN` (never `RESOURCE_NOT_FOUND` leaks of other patients' existence beyond what the context already reveals).
- **On-behalf auditing.** Every action records `actor_user_id`, `acting_as='GUARDIAN'|'SELF'` and `patient_id`.
- **Consent for dependents** requires `GIVE_CONSENT`. Consent rows record `given_by_user_id` and `relationship`.
- **What guardians and dependents see.** A guardian sees only the dependent's records within scope, never records of other dependents unless separately granted. Dependents' accounts never see guardian records.

## 5. Matrix

Legend: **C** create, **R** read, **U** update, **V** void/cancel, **A** approve/sign/finalize, **M** manage, **E** export, **-** denied.

Scope qualifiers:
- **(asg)** assigned doctor per §3 (encounter-level for A);
- **(scope)** clinic/chamber scope or care team;
- **(own)** own patient context;
- **(g:X)** guardian with scope X.

| Resource | tenant_owner | clinic_admin | doctor | nurse | receptionist | billing_manager | patient context |
|---|---|---|---|---|---|---|---|
| Tenant settings, memberships | M | M (own clinics; cannot grant `tenant.manage`/`ai.policy.manage`) | R own membership | R own | R own | R own | - |
| Clinics, chambers, schedules | CRUD/M | CRUD/M (scope) | R; U own schedule rules if granted | R | R | - | R public chamber info |
| Patients (demographics) | CRUD/M/E | CRUD/M (scope) | R/U (asg) | R/U limited (scope) | C/R/U demographics (scope) | R billing identity | R/U own limited (own, g:VIEW_RECORDS) |
| Patient merge cases | C/R/A | C/R/A (scope) | C/R (asg) | C | C | - | - |
| Patient accounts / guardianships | M | M (scope) | R (asg) | R (scope) | C/R/verify if granted `patient_account.manage`/`guardianship.manage` | - | C request (PENDING) own/dependents; R own |
| Care team / coverage | M | M (scope) | R; M own coverage if `coverage.manage` | R | - | - | - |
| Appointments | CRUD/M/E | CRUD/M (scope) | R/U (asg chambers) | R (scope) | C/R/U/V (scope) | R billing fields | C/R/V own (own, g:BOOK_APPOINTMENTS) |
| Serials (issue, check-in, cancel, reschedule, no-show) | CRUD/M | CRUD/M (scope) | R/M (own chambers) | R/M per policy (scope) | C/R/M (scope) | - | R own status + estimated position; check-in/remote-ready own (g:MANAGE_SERIALS) |
| Queue (call, skip, recall, reorder, delay, close day) | M/E | M (scope) | M call/skip/recall/reorder (own chambers); close day | M per chamber policy | M per chamber policy (no call by default) | - | R own position only |
| Encounters (start, interrupt, complete) | R/M/E | R/M (scope) | C/R/U/complete (asg) | C/R/U permitted sections (scope) | R status only | - | R shared summary (own, g:VIEW_RECORDS) |
| Encounter notes (draft, sign, correct) | R/E | R (scope) | C/R/U/A sign (asg) | C/R/U draft permitted sections (scope); no sign | - | - | R signed only |
| Diagnoses | R/E | R (scope) | C/R/U (asg) | C/R observed/proposed (scope) | - | - | R approved |
| Prescriptions | R/E/V (with reason) | R/V (scope, with reason) | C/R/U/review/A/V (asg) | R; review if granted `prescription.review`; no A | R status only | - | R approved (own, g:VIEW_RECORDS) |
| Prescription render | M | M (scope) | M (asg) | - | M re-render approved (scope) | - | - |
| Labs | CRUD/M/E | CRUD/M/E (scope) | C/R/U/review (asg) | C/R/U (scope) | C/R metadata (scope) | - | C/R own (own, g:UPLOAD_DOCUMENTS/VIEW_RECORDS) |
| Documents | CRUD/M/E | CRUD/M/E (scope) | C/R/U (asg) | C/R (scope) | C/R upload metadata (scope) | - | C/R own/shared |
| Timeline | R/E | R/E (scope) | R (asg)/E | R (scope) | R operational subset (scope) | - | R own approved/shared |
| Follow-ups | CRUD/M/E | CRUD/M (scope) | C/R/U (asg) | C/R task support (scope) | C/R scheduling (scope) | - | C/R own actions |
| Communications | CRUD/M/E | CRUD/M (scope) | C/R/M (asg) | C/R (scope) | C/R/M operational (scope) | - | R own; M own preferences (g:MANAGE_COMMUNICATION_PREFERENCES) |
| Telemedicine | M/E | M/E (scope) | C/R/M (asg) | R/join (scope) | R readiness (scope) | - | join own (g:JOIN_TELEMEDICINE) |
| AI use/review/approve | - by default (grantable `ai.use`/`ai.review` only; never `ai.approve`) | - | use/review/A (asg; own credentials only) | review only if granted `ai.review`; never A | - | - | - |
| AI credentials (own) | - | - | C/R metadata/U/V (own) | - | - | - | - |
| AI credentials (others') | M if granted `ai.credentials.manage` (no secret read) | M if granted `ai.credentials.manage` (no secret read) | - | - | - | - | - |
| AI data-use acknowledgement | - | - | C (self only) | - | - | - | - |
| Tenant AI policy | R/M (`ai.policy.manage`) | R | R | - | - | - | - |
| AI usage | R (`ai.usage.read`) | R if granted | R (own) | - | - | - | - |
| AI raw outputs | R (`ai.audit.raw_read`, audited) | - | - | - | - | - | - |
| Audit | R/E/M policy | R/E (scope) | R access to own assigned patients | - | - | - | R own access log where allowed |
| Payment intents (Stage 3.2) | C/R/E | C/R (scope) | R (own chambers); C if granted `payment.create` | - | C/R (scope; staff-assisted) | C/R/E | C/R own (own, g:MAKE_PAYMENTS) |
| Payment review (late/mismatch) | M (doctor-merchant intents) | M (scope, if granted `payment.merchant.manage`) | M own doctor-owned merchant intents | - | - | M if granted `payment.merchant.manage` | - |
| Fee schedules | M | M (scope) | R; U own `DOCTOR` scope if granted `fee.manage` | R | R | M | R applicable fee during booking |
| Merchant accounts, payment settings | M clinic-owned + platform opt-in; V doctor-owned (no secret read) | M clinic-owned (scope) | M own doctor-owned (no secret read after submit) | - | - | R metadata | - |
| Refunds (`DOCTOR_MERCHANT`) | M | M (scope) if granted `refund.manage` | M own doctor-owned merchant intents | - | - | M | R own refund status |
| SMS credentials | M | M if granted `sms.credentials.manage` | - | - | - | - | - |
| Subscription and invoices | R; C pay (`payment.create` + `tenant.manage`) | R | - | - | - | R | - |

### 5.1 Platform operator matrix (Stage 3.2)

| Resource | Platform permission | Access |
|---|---|---|
| Tenant bootstrap | `platform.tenants.bootstrap` | C |
| Operator grants | `platform.operators.manage` | M (cannot grant to self) |
| Dead letters, metrics, restore drills | `ops.jobs.replay`, `ops.metrics.read`, `ops.backup.restore_drill` | M/R/M |
| Platform SMS balance | `ops.sms.read` | R |
| Medication dataset imports and gate attestations | `medication.import` | C/R |
| Payouts, platform commission | `payout.manage` | M |
| Refunds of `PLATFORM_MERCHANT` intents, platform-merchant payment review | `platform.refund.manage` | M |
| Patient, clinical, document, AI data | — | **none** |
| Gate decisions (`platform_gate_decisions`) | — | CLI with DB access only |

## 6. Scope rules

- `tenant_owner` and `clinic_admin` cannot bypass audit, assignment or approval rules. Only assigned doctors approve prescriptions, sign notes and approve AI suggestions.
- **Voiding an approved prescription** requires `prescription.void`, a reason, and either assignment (doctor) or `tenant_owner`/`clinic_admin` with a mandatory second field `clinical_reviewer_doctor_profile_id` naming an assigned doctor who is notified. The void is audited.
- **Patients and guardians** cannot access drafts, AI artifacts, unreviewed lab extractions, other patients, or raw provider payloads.
- **Exports** are separately permissioned (`export.create`) and audited.
- **AI credential secrets are unreadable by everyone** (no endpoint, no DTO field, threat test). `ai.credentials.manage` means create, replace, disable, enable, revoke and revalidate, never read.
- **Provider credential secrets** (SMS API keys, aamarPay store ID + signature key) are **unreadable by everyone**, including the doctor who submitted them. Management permissions mean create, validate, disable and revoke only.
- **Payment amounts are never authorized from client input.** A patient context can pay only for its own (or scoped dependent's) business references.
- **Payment and SMS permissions never grant clinical access**, and payment status never gates clinical actions.

## 7. Tests

- `authorization-matrix.fixture.ts` mirrors §5 as data. The CI test `authorization-matrix.spec.ts`:
  1. parses the §5 table from this file and asserts it equals the fixture;
  2. computes `PolicyEngine` decisions for every role × permission × scope case and asserts they match;
  3. fails if `ROLE_PERMISSIONS` changes without a `ROLE_PERMISSIONS_VERSION` bump.
- **Assignment tests:** each of the 5 rules separately; coverage expiry; non-transitive coverage; solo tenant.
- **Patient context tests:** multi-tenant picker; dependent switch; missing scope; expired guardianship; PENDING guardianship denied; phone matching two patients does not auto-link.
- **AI tests:** clinic admin with `ai.credentials.manage` cannot read a secret; doctor A cannot use doctor B's credential; nurse cannot approve.
- **Stage 3.2 tests:**
  - doctor A cannot list, validate or disable doctor B's merchant account;
  - no role receives a secret field;
  - guardian without `MAKE_PAYMENTS` → `FORBIDDEN` on `POST /payments/intents`;
  - a platform permission in `tenant_memberships.permissions` is rejected on write;
  - an operator without `medication.import` gets `FORBIDDEN`;
  - a request with both `X-Platform-Context` and `X-Tenant-ID` → `PLATFORM_CONTEXT_REQUIRED`;
  - an operator session without OTP authn → `FORBIDDEN`.
