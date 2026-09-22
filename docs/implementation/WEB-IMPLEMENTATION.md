# Web Implementation Contract

**Stage 3.1 rewrite (2026-09-17).** Hosted as a static Vite build on `app.<domain>` (ADR-013).

**Stage 3.2 update (2026-09-17):** payment, fee and SMS settings routes, payment list and result pages, operator console, catalog source indicator (§4, §7).

## 1. Stack and ownership

- React 19.3.0, Vite 8.3.0, React Router 7.18.4 (data router), **TanStack Query 5.103.1** for server state.
- The generated TypeScript client comes from `openapi.v1.json` (`openapi-typescript` + `openapi-fetch`, pinned at WEB-001).
- The web app imports only `packages/contracts`, `packages/web-ui` and `packages/kernel` (dependency rule `web-only-contracts-and-ui`). It never talks to MariaDB, object storage, AI providers or other provider SDKs.
- Local UI state never becomes clinical source of truth.

## 2. Auth transport (ADR-013 §2)

- **Access token in memory only**, inside an `AuthSession` module closure. It is not stored in React state that dev tools persist, and never in `localStorage`/`sessionStorage`.
- **Refresh:** `fetch('https://api.<domain>/api/v1/auth/session/refresh', { method: 'POST', credentials: 'include', headers: { 'X-CSRF-Token': csrfToken } })`. The refresh cookie `__Host-hm_rt` is httpOnly, Secure and SameSite=Lax on `api.<domain>`. `csrfToken` is kept in memory; after a page reload, the app calls `POST /auth/session/csrf` (credentials included) and then refreshes.
- **Single-flight refresh** before expiry (at 80% of access-token TTL) and on 401. On refresh failure the app redirects to `/login`.
- **Other API calls** use `Authorization: Bearer` and `credentials: 'omit'`, so cookies are never sent on ordinary calls and CSRF exposure is limited to the auth endpoints.
- **Logout** calls `DELETE /auth/session` (credentials + CSRF), clears the TanStack Query cache and in-memory tokens, and broadcasts over `BroadcastChannel('hm-auth')` to other tabs.
- **Selected tenant** (`X-Tenant-ID`) is a UI preference kept in `localStorage` (`hm.tenant`) so reloads and deep links keep working (Stage 5). It is never authorization: the API validates the membership on every request. Cleared on logout.

## 3. Hosting specifics

- **`dist/.htaccess`** (template in `infrastructure/hostinger/web.htaccess`):
  - SPA fallback: rewrite non-file requests to `/index.html`;
  - security headers: CSP (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://api.<domain>; frame-ancestors 'none'; object-src 'none'; base-uri 'self'`), HSTS, `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `Permissions-Policy`;
  - long cache for hashed assets and `no-cache` for `index.html`.
  
  HOST-012 verifies. Fallback: hash routing (`createHashRouter`) plus headers from the API-served config endpoint (reduced).
- **Build-time public configuration** only (`VITE_API_BASE_URL`, `VITE_APP_ENV`, `VITE_BUILD_ID`). No secrets. The build fails if any `VITE_*` variable name matches `/SECRET|KEY|TOKEN|PASSWORD/`.

## 4. Routes

- `/login`, `/select-tenant`, `/dashboard`
- `/chamber-days/:chamberDayId/queue`
- `/patients/search`, `/patients/:patientId`, `/patients/:patientId/timeline`, `/patients/:patientId/guardianships`, `/patients/:patientId/care-team`
- `/appointments`
- `/encounters/:encounterId`, `/prescriptions/:prescriptionId`
- `/labs`, `/documents`, `/follow-ups`, `/communications`
- `/ai/review/:draftId`
- `/settings`, `/settings/memberships`, `/settings/coverages`, `/settings/ai-policy` (tenant owner), `/settings/ai/credentials` (doctor self), `/settings/doctors/:doctorProfileId/ai/credentials` (with `ai.credentials.manage`)
- `/audit`
- **Stage 3.2:**
  - `/settings/payments` (merchant accounts, payment settings, platform collection opt-in);
  - `/settings/fees` (fee schedules);
  - `/settings/sms` (tenant SMS credentials, balance, sender ID status);
  - `/payments` (intent list, refunds, manual review);
  - `/payments/result/:intentId` (payment result page; also the App/Universal Link fallback);
  - `/subscription` (tenant owner);
  - `/platform/*` (operator console: SMS balance, payouts, medicine imports and gate attestations; separate login flow with OTP step-up and `X-Platform-Context`).

Route loaders call permission-aware API endpoints. Hidden controls are not authorization.

## 5. Queue and consultation workspace

- **Deployment (ADR-023).** The built client is served by the API process at `/`, so it is same-origin: no
  CORS applies to it, and `apiBase()` resolves to an empty string (relative URLs) in a production build.
  `pnpm dev` still runs the client on 5173 against the API on 3000. A deep link is answered with the shell
  because the API's 404 is rewritten for `GET`/`HEAD` requests that asked for `text/html` and are not under
  `/api`, `/health` or `/internal`; `/assets/*` is fingerprinted by Vite and cached `immutable`, the shell
  never is. Moving the client to its own subdomain is configuration only: `WEB_DIST_DIR`,
  `CORS_ALLOWED_ORIGINS` and `VITE_API_BASE_URL`.
- **Queue view polls** `GET /chamber-days/{id}/queue` every 5 s while the tab is visible (`refetchInterval` + `If-None-Match`), pauses when hidden, and refetches on focus.
- Every mutation sends `Idempotency-Key` (generated per click intent; reused on retry) and `expectedRowVersion` / `expectedQueueOrderVersion`.
- Conflicts (`STALE_VERSION`, `QUEUE_STATE_CONFLICT`, `QUEUE_VERSION_CONFLICT`) show a reload prompt with the current server state. No blind merge.
- **Consultation workspace:**
  - identity, serial status, timeline, prior prescriptions/labs;
  - note sections: autosave debounced (≥ 2 s idle, ≤ 1 request per 5 s), `expectedRowVersion`, conflict banner showing the server copy;
  - diagnoses, prescription draft, follow-up, AI panel.
- **Manual completion** always works when AI, video, SMS, WhatsApp, email, push or PDF rendering fails.
- **AI panel:**
  - visible only with an `ACTIVE` credential and the tenant AI enabled;
  - shows the credential data-use class chip next to each action ("Free tier — provider may use data to improve its products");
  - per-suggestion accept/edit/reject/ignore;
  - per-item approve with attestation;
  - no bulk approval of diagnoses.

## 6. Patient and staff views

Patient web views (if enabled) are limited to approved or shared artifacts and their own serial state, using the same patient-context header rules as mobile. Reception staff see operational minimum fields. Admin and audit views require explicit permission and redaction.

## 7. Tests (Playwright 1.63.0, against local API + mocks)

- Login (OTP mock and password)
- Tenant switching
- Access token never in web storage (`page.evaluate` storage scan)
- Refresh with CSRF, and CSRF failure without the header
- Patient search
- Walk-in and queue transitions with conflict prompt
- Reorder conflict
- Consultation note autosave conflict
- Prescription review → approve
- Timeline
- Upload (proxied mode) resume
- Communication failure display
- AI credential add → validation → acknowledgement flow (mock provider)
- Data-use chip visible
- Nurse cannot approve
- Unauthorized route states
- SPA deep-link reload (static server with `.htaccess`-equivalent config in CI)
- **Stage 3.2:**
  - staff-assisted prepaid booking → payment link/QR → mock gateway success → `/payments/result/:id` shows `PAID` → serial appears in the queue;
  - forged success POST leaves the intent unpaid (UI shows "Confirming…" then not paid);
  - fee schedule edit conflict (`STALE_VERSION`);
  - merchant account create → secret fields cleared and never re-displayed;
  - SMS credential create → validate → balance shown as an estimate;
  - prescription editor shows the "Unverified catalog" badge and no dose prefill;
  - the `dist/` bundle scan finds no `AAMARPAY_`/`ZAMANIT_` values.
