# Mobile Architecture Specification

## 1. Strategy

Use a shared Flutter architecture for Doctor Mobile and Patient Mobile, with shared design tokens, API client, auth/session handling, offline primitives, upload queue, and domain DTOs. Keep role-specific features in separate app shells or feature modules. This studies Medigo’s patient/doctor split and DocPilot’s shared package pattern without inheriting their obsolete dependencies or direct Firebase writes.

Android is the primary target. iOS support should remain possible but must not delay low-end Android quality.

## 2. Shared layers

- `core`: environment, secure storage, error model, localization, connectivity, analytics redaction.
- `auth`: OTP/password/session/verification and device revoke.
- `api`: typed REST client, retry policy, idempotency, cursor pagination.
- `offline`: local cache for safe read models, outbox for explicitly retryable mutations, conflict/version handling.
- `uploads`: resumable object upload sessions, checksum, retry, scan status.
- `domain`: patient, appointments, serials, encounters, prescriptions, timeline, follow-ups.
- `ui`: accessible shared components, Bangla/English typography and formatting.

## 3. Doctor app

MVP flows:

1. Login and tenant/chamber selection.
2. Today’s chamber day and queue.
3. Check-in, call, skip, recall, reorder with permission.
4. Start physical or remote encounter.
5. Review patient timeline and prior prescriptions/labs.
6. Edit structured note and prescription draft.
7. Review AI draft if available; approve final clinical records.
8. End encounter and create follow-up.
9. View delivery status and failed notifications.

The doctor app MUST remain usable manually when video, AI, or a notification provider is unavailable.

## 4. Patient app

MVP flows:

1. OTP/login and patient profile.
2. Search/select doctor or receive a tenant link.
3. Book appointment or request remote serial.
4. Check in and see current queue position/delay without exposing other patients.
5. Join authorized remote encounter or follow physical chamber instructions.
6. View approved prescription, lab report, documents, and timeline.
7. Receive and schedule follow-up.
8. Manage communication preferences and consent.

## 5. Offline and low bandwidth

- Cache only minimum necessary patient-owned/read-authorized data on device.
- Encrypt local storage and clear it on logout/device revoke.
- Use an outbox only for safe, user-visible operations with idempotency keys; clinical finalization requires server confirmation.
- Show pending/synced/failed state for every queued operation.
- Resume uploads by part; compress images before upload; preserve original metadata separately.
- Audio-only fallback when video quality or bandwidth drops.
- Reconnect session and refresh join token without duplicating encounter or queue transitions.
- Use server timestamps for queue truth; the client never calculates authoritative position.

## 6. Push notifications

Push is an optimization, not the only channel. Deep links open an authenticated API view; payloads contain opaque IDs and minimal text. Delivery failure falls back according to communication preferences.

## 7. Android quality baseline

- Test low-memory and low-end Android devices.
- Avoid large startup bundles and unnecessary video assets.
- Support interrupted process restart, expired sessions, denied permissions, poor connectivity, and clock skew.
- Use accessible touch targets, Bangla text rendering, and dynamic text sizing.
- Do not include production credentials or provider secrets in the app.

## 8. Mobile test strategy

Unit-test state reducers and serializers; integration-test auth, API retries, outbox, upload resume, queue display, prescription access, and permission failures. Device tests cover offline/online transitions, remote join/reconnect, low bandwidth, notification deep links, and logout data clearing.

## Change log

### 2026-09-17 — Stage 3.1

- Queue freshness uses conditional polling with backoff; push remains a refresh hint (ADR-013, audit C-09).
- Mobile apps live in a separate `mobile/` Melos workspace with a Dart client generated from the OpenAPI 3.0 artifact (`docs/implementation/REPOSITORY-STRUCTURE.md`).
- Patient apps support multiple clinic contexts and dependents via patient accounts and guardianships (audit C-15). Doctor apps manage the doctor's own AI credentials; secrets are write-only (ADR-017).

### 2026-09-17 — Stage 3.2

- Patient app pays for appointments by opening the server-issued gateway URL in an external browser tab (Custom Tabs / SFSafariViewController) and returns through App Links / Universal Links to a result screen that shows the server status. No gateway credentials or aamarPay mobile SDKs in the app (ADR-019).
- OTP screens never auto-resend; a resend creates a new code within limits (ADR-018). The doctor prescription editor shows the catalog source indicator and never pre-fills doses (ADR-020).
