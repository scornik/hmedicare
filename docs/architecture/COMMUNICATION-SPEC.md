# Communication Specification

## 1. Provider-neutral model

Business modules create a `Communication` intent. A channel adapter performs delivery:

```text
CommunicationService -> ProviderAdapter -> WhatsApp / SMS / Email / Phone / Push / Video
```

The business action never calls a Twilio, WhatsApp, SMTP, Agora, Jitsi, or other provider SDK directly.

## 2. Supported channels

- `in_app`: timeline/notification and message inbox.
- `email`: prescription, appointment, follow-up, and account messages where consented.
- `sms`: OTP, queue updates, fallback, and essential notification where configured.
- `whatsapp`: template-based messages through an approved provider adapter; no generic API assumption.
- `phone`: provider-neutral call intent or click-to-call handoff; PSTN ownership is an open question.
- `video`: telemedicine session adapter, separate from message delivery.

## 3. Delivery state machine

```text
CREATED -> CONSENT_CHECKED -> QUEUED -> SENDING -> SENT
SENT -> DELIVERED -> READ
SENDING/SENT -> FAILED -> RETRY_SCHEDULED -> QUEUED
CREATED/QUEUED -> CANCELLED
```

Provider-specific states map into this normalized state. A delivery attempt stores provider message ID, attempt number, timestamps, redacted error class, and receipt. It never stores an access token or raw PHI provider payload in ordinary logs.

## 4. Idempotency and retry

- `Communication.idempotency_key` is unique per tenant.
- A worker may retry transient failures with exponential backoff and a maximum attempt policy.
- Permanent failures require a visible reason and optional alternate channel.
- Delivery receipts are webhook-verified where the provider supports signatures.
- Webhooks are authenticated, deduplicated by provider event ID, and mapped to a communication attempt.

## 5. Consent and preferences

Before sending, evaluate:

- patient channel preference and opt-out;
- purpose and consent basis;
- tenant template/channel configuration;
- destination verification state;
- whether the content is allowed for that channel;
- whether a fallback is authorized.

A patient may choose portal-only, email, SMS, WhatsApp, or a combination. Essential account/security messages have separate policy and legal review.

## 6. WhatsApp

Treat WhatsApp as a provider integration with explicit constraints:

- use approved templates where required;
- store template version and locale;
- record consent and opt-out;
- support delivery/failure receipts;
- do not assume calling and messaging have the same API or consent behavior;
- fall back to SMS/email/in-app only when patient preference and policy allow;
- never place a permanent signed document URL in a message; use an expiring authorized link or portal notification.

Provider selection, template approval, business verification, and Bangladesh availability remain open questions.

## 7. SMS/email

- SMS adapter supports Bangladesh E.164 normalization, provider message IDs, sender configuration, retries, and failover.
- Email uses a transactional provider abstraction, template version, unsubscribe/preference behavior, and bounce handling.
- OTP delivery is isolated from general communications and has stricter rate limits.
- Prescription PDFs are generated first, stored privately, then delivered using an authorized short-lived link or attachment policy.

## 8. Notifications

Queue notifications are generated from serial events: booked, confirmed, checked-in, called, delayed, skipped, recalled, and cancelled. Notifications contain minimum necessary content. Patient-facing queue position is derived from current eligible serials and is not disclosed to unauthorized users.

## 9. Video/audio

`TelemedicineProvider` exposes `createSession`, `issueParticipantToken`, `endSession`, and `recordParticipantEvent`. The initial adapter may use an external provider or WebRTC-compatible service; the selection is intentionally open. Provider credentials stay server-side.

- No recording by default.
- Session token is short-lived and encounter/participant scoped.
- Reconnect events are recorded without treating a temporary disconnect as encounter completion.
- Audio-only mode is a first-class fallback.
- Low-bandwidth mode can disable video while preserving audio/chat.
- A phone handoff is recorded as a communication event if the platform does not own the call.

## 10. Asynchronous operations

Background jobs handle outbound delivery, receipts, PDF generation, push notifications, and provider webhooks. Queue/encounter state changes remain synchronous transactions; notification fan-out follows the committed event.

## Change log

### 2026-09-17 — Stage 3.1

- Delivery work runs on the MariaDB job queue (`notifications` queue) with outbox dispatch and DB-backed idempotency (ADR-015).
- OTP messages are sent synchronously after the OTP challenge commits, not via the job queue (`docs/implementation/AUTH-IMPLEMENTATION.md`).
- Video signaling and media are hosted by the selected telemedicine provider; the platform origin does not accept inbound WebSockets (ADR-013).

### 2026-09-17 — Stage 3.2

- Zaman IT is the first SMS adapter and the OTP delivery transport (ADR-018). Normalized terminal state for Zaman IT SMS is `SENT` unless a delivery-report source is verified; `DELIVERED`/`READ` are not invented.
- Duplicate safety without provider idempotency: no automatic OTP resend; at most one transactional retry after an unknown outcome, flagged as a possible duplicate.
- SMS templates are versioned (bn-BD, en-BD) and may contain only generic text, OTP code, serial number, time, clinic SMS name and an opaque login-required short link.
