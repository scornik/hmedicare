# Authentication Implementation Contract

**Stage 3.1 rewrite (2026-09-17).** Storage in MariaDB (no Redis, ADR-015). Web transport per ADR-013 §2. Patient contexts per `AUTHORIZATION-MATRIX.md` §4.

**Stage 3.2 update (2026-09-17).**
- OTP SMS delivery uses Zaman IT through `OtpDeliveryPort` → `SmsProvider` (ADR-018).
- The OTP TTL default is shortened to 180 s because of the HTTP transport risk.
- Platform operator authentication is added (§2.6).

## 1. Components (`packages/identity-access`)

- **`PasswordHasherPort`** → `Argon2idHasher` (`argon2@0.45.1`). Parameters come from configuration: `ARGON2_MEMORY_KIB` (default 19456), `ARGON2_TIME_COST` (2), `ARGON2_PARALLELISM` (1). They are tuned at HOST-002 so a hash takes ≤ 250 ms on the plan and stays within the memory budget. Rehash on login when parameters change.
- **`TokenService`** (`jose@6.2.12`): Ed25519 (EdDSA) access JWTs.
  - Claims: `iss`, `aud`, `sub` (user id), `sid` (session id), `tv` (user `token_version`), `iat`, `exp`, `kid`.
  - **No tenant list and no PHI.** Memberships are resolved per request from the database, with memoization within the request.
  - `JWT_ACCESS_TTL_SECONDS` default 600.
  - Keys: `JWT_SIGNING_PRIVATE_KEY` (PKCS#8 PEM) and `JWT_SIGNING_KEY_ID`. Verification accepts `JWT_VERIFICATION_KEYS` (JSON map `kid → public PEM`) for rotation.
- **`SessionService`** (`sessions`, `refresh_tokens`):
  - opaque refresh tokens (32 random bytes, base64url), stored as HMAC-SHA-256 with `REFRESH_TOKEN_PEPPER`;
  - rotation on every refresh; family reuse detection;
  - idle timeout `SESSION_IDLE_TIMEOUT_HOURS` (web 12, mobile 720) and absolute timeout `SESSION_ABSOLUTE_TIMEOUT_DAYS` (web 7, mobile 90).
- **`OtpService`** (`otp_challenges`) with the **`OtpDeliveryPort`** (renamed from `OtpProvider`, ADR-018 §1):
  - `MockOtpDelivery` is used locally and in CI;
  - `SmsOtpDelivery` delegates to the communication `SmsProvider` (Zaman IT adapter, platform account) when `OTP_PROVIDER=sms` and `SMS_PROVIDER=zamanit`;
  - WhatsApp OTP remains a future adapter behind the same port.
  - HMedic generates, hashes, expires and verifies codes; the provider only transports text.
- **`CsrfService`:** HMAC(`CSRF_SECRET`, sessionId ‖ random) tokens for web cookie flows.
- **`RateLimiterPort`** → DB counters (ADR-015).
- **`ActorContextResolver`**, **`PatientContextResolver`**, **`PolicyEngine`**, **`AssignmentPolicy`**.

## 2. Flows

### 2.1 OTP login (patients; optional for staff)

1. **`POST /auth/otp/request {phone, purpose}`.**
   - Normalize to E.164 (`libphonenumber-js`).
   - Rate limits: `otp:phone` (default 3 per 15 min, 10 per day), `otp:ip` (20 per hour), `otp:device` (header `X-Device-Id`, hashed).
   - Supersede any pending challenge. Generate a 6-digit code with `crypto.randomInt`. Store `code_hash = HMAC(OTP_PEPPER, challengeId ‖ code)`, `expires_at = now + OTP_TTL_SECONDS` (**180**; max 300). Commit.
   - Deliver the code synchronously through `OtpDeliveryPort.send` after commit (no job; see code handoff below). The SMS text comes from template `otp_login`/`otp_phone_verify` (`bn-BD` or `en-BD` by the request `locale`, default `bn-BD`) and contains only the app name, the code and the validity minutes.
   - **Response is identical whether or not the phone exists** (no enumeration).
   - **Code handoff:** the code is never persisted in plaintext or placed in a job payload. The API calls `OtpDeliveryPort.send` directly (outside the DB transaction) after commit, with a bounded timeout (`ZAMANIT_TIMEOUT_MS`). Delivery is synchronous by design, so no code sits in a queue.
   - **Delivery outcomes (ADR-018 §4):**
     - `ACCEPTED` → `202`;
     - `REJECTED` or `PROVIDER_UNAVAILABLE` → the challenge is marked `EXPIRED`, `202` with a generic retry hint, and an alert for credential or balance classes;
     - `UNKNOWN_OUTCOME` (timeout after send, 5xx, unparseable) → the challenge **stays `PENDING`** (the SMS may have been delivered), and `202` with the hint "if the code does not arrive, request a new code".
     - **No automatic resend ever happens.** A user resend creates a new challenge, supersedes the old one, and is limited by `otp:phone` (3 per 15 min, 10 per day).
     - The attempt outcome is recorded as a metric (`otp_delivery_total{outcome}`), not in `communications`.
2. **`POST /auth/otp/verify {phone, code, deviceId}`.**
   - Lock the pending challenge row, check expiry, increment attempts (≥ `max_attempts` → `LOCKED`), constant-time compare, mark `VERIFIED` and `consumed_at`.
   - Upsert `users` by `phone_e164` (create with status `ACTIVE`, `phone_verified_at`).
   - Create session and refresh-token family.
   - Evaluate automatic patient-account linking (`AUTHORIZATION-MATRIX.md` §4: exactly one verified contact match per tenant).
   - Audit `AUTH_OTP_VERIFIED`.
3. **Response:**
   - web: `Set-Cookie: __Host-hm_rt=…; Secure; HttpOnly; SameSite=Lax; Path=/` and `__Host-hm_csrf=…; Secure; HttpOnly; SameSite=Strict; Path=/`, body `{accessToken, accessTokenExpiresAt, csrfToken, user}`;
   - mobile (`client=android|ios` in body): body `{accessToken, refreshToken, …}`, no cookies.

**Mock provider:** in `APP_ENV=development|test`, `MockOtpDelivery` records codes in memory and exposes them only via `GET /internal/test/otp/{challengeId}`, which is registered **only** when `APP_ENV=test`. It never logs codes.

### 2.2 Password login (staff/doctor)

`POST /auth/password/login {email, password}`:
- rate limits `login:account` (5 per 15 min, then progressive delay) and `login:ip`;
- a generic error for any failure;
- Argon2id verify;
- optional OTP step-up if the tenant policy `requireOtpForStaff=true` (returns `{challengeId}` and completes via `/auth/otp/verify` with purpose `LOGIN`).

### 2.3 Refresh

`POST /auth/session/refresh`:
1. Web: require the `__Host-hm_rt` cookie, the `X-CSRF-Token` header equal to the `__Host-hm_csrf` cookie and HMAC-valid for the session, and an `Origin` in `CORS_ALLOWED_ORIGINS`. Mobile: `refreshToken` in the body.
2. Lock the `refresh_tokens` row by `token_hash`. If `used_at` is set → **reuse**: revoke the family and session (`REFRESH_REUSE`), audit a security event, return 401.
3. Check session active and the user's `token_version` unchanged; set `used_at`; issue a new token (same family); update `last_seen_at` and `idle_expires_at`.
4. Return a new access token and, for web, a new `csrfToken` and rotated cookies.

### 2.4 Logout, revocation, password changes

- **Logout:** `DELETE /auth/session` revokes the current session. `POST /auth/session/logout-all` revokes all of the user's sessions and bumps `users.token_version`, which invalidates outstanding access tokens.
- **Password reset:** `password_reset_tokens` (single use, 30 min, hashed). Completion sets the new hash, revokes all sessions and bumps `token_version`.
- **Device revoke:** `DELETE /me/sessions/{id}` revokes that session. Mobile clears local data on the next 401 `SESSION_REVOKED`.

### 2.5 Request authentication

For every request:
1. Verify the JWT signature, `iss`, `aud`, `exp` and `kid`.
2. Load the session (by `sid`) and user (`tv` must equal `token_version`) with a single indexed query. An in-process LRU cache of **session status only** (not PHI) for ≤ 30 s is allowed, and is invalidated on revoke in the same process.
3. Build `ActorContext {userId, sessionId, authnMethods, clientType}`.
4. If `X-Tenant-ID` is present, resolve membership → `TenantContext {tenantId, membershipId, role, effectivePermissions, clinicIds, chamberIds, rolePermissionsVersion}`.
5. If `X-Patient-Context` is present, resolve `PatientContext {tenantId, patientId, actingAs: SELF|GUARDIAN, authorityScope}`.
6. Route guards check route metadata (`permission`, `patientScope`, `requiresAssignment`). Use cases re-check resource-level scope.

### 2.6 Platform operators (Stage 3.2)

- **Who.** A platform operator is a `users` row with an `ACTIVE` `platform_operators` row. It is not a tenant role. Operators hold only the platform permissions listed on their row (AUTHORIZATION-MATRIX §2).
- **Granting.** The first operator is granted by `pnpm ops:platform-operator grant --email <e> --permissions <list>`, run with production DB access by the account owner; it writes a platform audit event. Later grants require `platform.operators.manage`.
- **Authentication:** password login **plus** OTP step-up on every new session (`authn_methods` must contain both `pwd` and `otp`); idle timeout `PLATFORM_OPERATOR_SESSION_IDLE_MINUTES` (30), absolute 12 h.
- **Using platform routes.** Requests to `/platform/*`, `/admin/*` and `/internal/ops/*` send `X-Platform-Context: operator`. The resolver loads the operator row, and every request is audited on the platform chain (`actor_type=OPERATOR`). A request cannot carry both `X-Platform-Context` and `X-Tenant-ID`.
- **Read-only default.** Operators cannot read patient data through platform routes; no platform route returns PHI.

## 3. OTP and rate-limit storage (DB)

- `otp_challenges` and `rate_limit_counters` are defined in `DATABASE-IMPLEMENTATION.md` §3.1 and §3.3. Cleanup runs through `MaintenanceTtlCleanup` (ADR-015).
- **Rate-limit algorithm (sliding-window approximation):**
  ```text
  estimate = count(current_window) + count(previous_window) × (1 − elapsed/window)
  ```
  The counter is incremented with `INSERT … ON DUPLICATE KEY UPDATE count = count + 1`. Subjects are HMAC-hashed.

## 4. Security properties (tested)

- **Never logged:** passwords, OTP codes, reset tokens, refresh tokens, access tokens, the `Authorization` header or cookies (redaction test).
- Constant-time comparisons for OTP, CSRF and cron/metrics tokens.
- Refresh reuse revokes the family.
- The patient-context header cannot escalate: every request re-validates the account or guardianship.
- `POST /tenants` is unreachable with tenant sessions.
- Platform routes reject sessions without `pwd`+`otp` authn methods, and reject tenant headers.
- OTP `UNKNOWN_OUTCOME` never triggers an automatic resend (mock test).
- Web access tokens never touch `localStorage`/`sessionStorage` (Playwright check).
