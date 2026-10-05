# ADR-025 — Email as an OTP delivery channel

**Status:** Proposed (2026-10-05, Stage 7). **Needs an owner decision before work starts** — see §8.
**Extends:** ADR-018 (Zaman IT as the first SMS and OTP delivery adapter).
**Prompted by:** a production installation with `SMS_PROVIDER='mock'` where no platform operator can
complete the step-up that every `/admin/*` route requires, so the medication-catalog import cannot be
authorized at all.

## Context

### What exists today

- **The OTP lifecycle belongs to HMedic** (ADR-018 §1). A provider only transports text. `OtpService`
  generates the code, HMAC-hashes it with the challenge id, expires it, and verifies it.
- **Every platform route requires two factors.** `packages/identity-access/src/nest/auth.guard.ts:64`
  denies the request unless the session's `authnMethods` contains both `pwd` and `otp`. Password login
  alone issues `authnMethods: ['pwd']` (`password-auth.ts:98`), so an operator with a password and no
  OTP can authenticate but can reach nothing under `/platform/*`, `/admin/*` or `/internal/ops/*`.
- **The OTP model is phone-shaped throughout.**
  - `OtpService.config.channel` is typed `'SMS' | 'MOCK'` (`otp-service.ts:57`).
  - `OtpService.request()` takes `phone`, and its first act is `normalizeBdMobile(input.phone)`,
    rejecting anything that is not a Bangladeshi mobile number.
  - `destinationHash` is `hmacHex(otpPepper, 'otp-destination', phoneE164)`.
  - `OtpDeliveryPort.send()` takes `phoneE164`.
  - Rate limits key on `phoneE164` (`OTP_LIMITS.phone`, `OTP_LIMITS.phoneDaily`).
  - The `otp_challenges` CHECK constraint permits `channel IN ('SMS', 'WHATSAPP', 'MOCK')`.
- **Nothing in this system can send an email.** The only implementations of
  `PasswordResetNotifierPort` are `MockPasswordResetNotifier` and `NoopPasswordResetNotifier`
  (`password-auth.ts:206`, `:217`), and `identity-services.ts:78` wires the Noop outside development.
  `packages/config/src/schema.ts` holds no SMTP or email-provider keys. The `email_verification_tokens`
  table exists in the schema and no code reads or writes it.
- **No email provider has been selected.** `COMBINED-ARCHITECTURE-SPEC.md:3004` records SMS (Zaman IT)
  and payments (aamarPay) as chosen, and states that WhatsApp, email, push and video remain unselected.

### The honest shape of the problem

This is not "add a channel to a channel-agnostic OTP service". The OTP service has one destination
concept — a Bangladeshi mobile number — expressed in its types, its hashing, its rate limits and its
database constraint. Adding email touches each of those. And the transport underneath does not exist in
any form, for any purpose: email would be the first outbound email this product has ever sent, which
brings sender identity, deliverability and bounce handling with it.

## 1. Security position

**Email is a weaker second factor than SMS, and for a platform operator it is weaker than the thing it
protects.** An operator holding `medication.import` can replace the medication catalog every prescriber
in every tenant reads from. If the second factor is an inbox, then whoever controls that inbox — or an
attacker with its password, or a mail provider's support desk persuaded to reset it — holds the factor.
Email adds no possession of a distinct device; a password manager and an email client commonly live
behind the same unlocked laptop.

Three consequences, which the work must honor rather than note:

1. **Email OTP is for accounts whose blast radius is bounded, or as an explicitly-accepted
   compensating control with an expiry.** This ADR proposes it be gated the way `GATE-SMS-HTTP` gates
   plain-HTTP SMS (ADR-018 §2): permitted in production only while a non-expired platform audit record
   `EMAIL_OTP_RISK_ACCEPTED` exists, written by `ops:record-risk-decision` with a named owner and an
   expiry date.
2. **Channel is recorded per challenge and surfaced in the audit trail.** `otp_challenges.channel`
   already carries it; the session's `authnMethods` must distinguish an email-verified step-up from an
   SMS one, so that a later reviewer can tell which factor actually admitted an operator. This ADR
   proposes `otp` stays the method name and the channel is carried in the audit metadata, because
   widening `AuthnMethod` would change `isOperatorSession` and every session-window rule with it.
3. **It does not become the default for patients or staff.** Patient login is phone-first by product
   design, and an email channel reachable by anyone who knows an address is a new enumeration and
   abuse surface on the busiest unauthenticated endpoint in the system.

## 2. Transport decision (open — §8)

Two candidates, and the choice changes the work:

| | **A. SMTP (Hostinger mailbox)** | **B. HTTP email API (e.g. a transactional provider)** |
|---|---|---|
| New dependency | an SMTP client library | none beyond `fetch` |
| Secret | mailbox password | API key, same handling as `ZAMANIT_API_KEY` |
| Transport security | SMTP+STARTTLS or implicit TLS, verified | HTTPS, verified |
| Deliverability | tied to the domain's own reputation; SPF/DKIM/DMARC must be configured for `hmedicare.hakeemify.com` | provider-managed reputation, still needs domain authentication |
| Bounce/complaint signal | parsing a mailbox, or nothing | webhook or API |
| Failure semantics | a 250 from the relay is not delivery | same, plus provider status |
| Cost | included in hosting | per-message or monthly |
| Fits ADR-018's shape | partly — no `UNKNOWN_OUTCOME` analogue from a relay | closely; mirrors `SmsProvider` |

**Recommendation: B**, for one reason that outweighs the rest — it mirrors `SmsProvider` exactly, so
`EmailProvider` inherits ADR-018's four-outcome result type (`ACCEPTED`, `REJECTED`,
`PROVIDER_UNAVAILABLE`, `UNKNOWN_OUTCOME`), its credential handling, its fixture-based parser
discipline and its mock adapter pattern. SMTP's "the relay accepted it" tells you materially less, and
a mailbox is a worse place to discover that operator codes stopped arriving.

Either way, **no OTP code ever travels over an unauthenticated or unverified transport**, and TLS
verification is never disabled — the ADR-018 §2 rules carry over unchanged.

## 3. Proposed design

```text
identity-access: OtpService ──> OtpDeliveryPort ──┬─> SmsOtpDelivery  ──> SmsProvider   (ADR-018)
                                                  └─> MailOtpDelivery ──> EmailProvider (this ADR)
```

### 3.1 Destination becomes a tagged value, not a phone

```ts
export type OtpDestination =
  | { kind: 'PHONE'; phoneE164: string }
  | { kind: 'EMAIL'; emailNormalized: string };
```

- `OtpService.request()` accepts an `OtpDestination` instead of `phone`. The Bangladeshi-mobile
  normalization stays, applied to the `PHONE` arm only; the `EMAIL` arm normalizes with the existing
  `normalizeEmail` (`password-auth.ts:10`), which is what `users.email_normalized` already stores.
- `destinationHash` keeps its shape and gains the kind in the HMAC label:
  `hmacHex(otpPepper, 'otp-destination:email', emailNormalized)`. Separating the labels means a phone
  and an address can never collide into one challenge, and an existing phone hash keeps its value, so
  pending challenges survive the deployment.
- The route that requests an OTP takes exactly one of `phone` or `email`, never both.

### 3.2 Channel and database

- `channel` gains `'EMAIL'`: a migration alters `chk_otp_challenges_channel` to
  `channel IN ('SMS', 'WHATSAPP', 'EMAIL', 'MOCK')`.
- No new table and no new column: an email challenge is an `otp_challenges` row like any other, which
  is the point of hashing the destination rather than storing it.

### 3.3 Rate limits

Email needs its own limits, keyed on the address, and they are not the phone numbers' limits:

| Rule | Proposed | Why |
|---|---|---|
| `otp:email` | 3 per 15 min | A mail round trip is slower than an SMS; a lower ceiling costs a legitimate user nothing. |
| `otp:email:day` | 10 per day | Bounds the cost of someone pointing the endpoint at an address they do not own. |
| `otp:email:domain` | 60 per hour | One compromised script should not get the sending domain blocklisted for every other recipient. |

The per-IP and per-device rules already in `OTP_LIMITS` apply unchanged.

### 3.4 Templates

Subject and body in both locales, in the localization package with every other string (no Bangla
outside localization files). The body carries the code, its lifetime, and one line saying that nobody
from HMedic will ask for it. No PHI, no tenant name, no patient name, nothing about why the code was
requested beyond the purpose. HTML and plain-text alternatives, because a text-only body in a
healthcare context is likelier to be filed as spam.

### 3.5 What stays untouched

- `authnMethods` values, `isOperatorSession`, and every session window rule.
- The guard at `auth.guard.ts:64`. An email step-up satisfies `otp` because the code was still
  generated, hashed and verified by HMedic; the weaker link is delivery, which §1 gates rather than
  pretends away.
- Patient OTP login, which remains phone-only.

## 4. Work breakdown

| ID | Title | Depends on | Notes |
|---|---|---|---|
| MAIL-001 | Owner decision on transport and risk acceptance (§8) | — | Blocks everything below. Not an engineering task. |
| MAIL-002 | `EmailProvider` port + `MockEmailAdapter`, mirroring `SmsProvider` and `MockSmsAdapter` | MAIL-001 | Four-outcome result type; never records the body or the full address. |
| MAIL-003 | Real adapter for the chosen transport, with a fixture-based response parser | MAIL-002 | Fixtures from the provider's real responses, per ADR-018 §1's SMS-002 precedent. |
| MAIL-004 | Config keys, secret handling, startup validation | MAIL-002 | `EMAIL_PROVIDER`, sender identity, credential via the existing KEK-wrapped path. No secret in a URL. |
| MAIL-005 | `OtpDestination` refactor in `OtpService` + `MailOtpDelivery` | MAIL-002 | Includes the HMAC label split and the request-route change. |
| MAIL-006 | Migration: `chk_otp_challenges_channel` gains `EMAIL` | MAIL-005 | Forward-only; no data change. |
| MAIL-007 | Email rate limits (§3.3) | MAIL-005 | New rules in `OTP_LIMITS`. |
| MAIL-008 | Templates, both locales, HTML + text | MAIL-005 | Localization files only. |
| MAIL-009 | `GATE-EMAIL-OTP` production gate + `EMAIL_OTP_RISK_ACCEPTED` risk record | MAIL-004 | Same mechanism as `GATE-SMS-HTTP`. |
| MAIL-010 | Bounce and complaint handling | MAIL-003 | At minimum: a hard bounce marks the address unusable for OTP and the operator is told why login stopped working. |
| MAIL-011 | Tests | MAIL-005…010 | §5. |
| MAIL-012 | Docs: AUTH-IMPLEMENTATION §2.1, ENVIRONMENT-CONTRACT, DEPLOYMENT §4a, SECURITY-SPEC | all | Including that email OTP is gated and why. |

**Estimate: 5–8 working days** for MAIL-002…012 with tests and documentation, assuming the transport
decision is made and provider fixtures are obtainable. MAIL-003 and MAIL-010 carry the variance: a
provider whose responses are poorly documented, or whose bounce signal is a webhook needing a public
endpoint, moves the upper bound.

## 5. Tests the work must include

1. An email challenge is created, hashed and verified end to end, and the code never appears in any
   row, log line or job payload.
2. A phone challenge and an email challenge for the same user are distinct challenges and neither
   consumes the other (the HMAC label split, asserted rather than assumed).
3. Requesting an email OTP supersedes a pending email OTP for the same address and leaves a pending
   phone challenge alone.
4. Each rate limit in §3.3 refuses at its ceiling, and the per-domain rule refuses without exhausting
   the per-address rule.
5. `REJECTED` and `PROVIDER_UNAVAILABLE` expire the challenge; `UNKNOWN_OUTCOME` leaves it pending —
   the ADR-018 §1 semantics, re-asserted for this channel.
6. A platform route still refuses a `pwd`-only session, and admits a `pwd`+`otp` session whose OTP came
   by email, with the channel visible in the audit record.
7. In production with no valid `EMAIL_OTP_RISK_ACCEPTED` record, the email channel refuses to send and
   says so; with one, it sends. An expired record is not a valid one.
8. A hard bounce makes the address unusable and surfaces a distinguishable error rather than a silent
   non-delivery.
9. No Bangla string outside the localization files; no address or code in metrics labels or audit
   metadata.

## 6. What this does not solve

- **Gate G-1** (a password recovery path a user can reach) is adjacent but separate. An email transport
  makes it buildable; it does not build it.
- **Operator step-up on the deployed installation today.** Until this work ships, the only ways to
  complete the step-up are a real SMS provider or a development-mode mock, and neither is this ADR.
- **Patient-facing email.** Out of scope; the product's patient channel is SMS and the portal.

## 7. Alternative considered: configure the existing SMS provider instead

Setting `SMS_PROVIDER=zamanit` with a valid `ZAMANIT_API_KEY` completes the operator step-up with no
code change, using a path that already has an adapter, fixtures, tests, a rotation runbook
(`DEPLOYMENT.md` §7) and a production gate. It is strictly less work and a stronger second factor.

This ADR is still worth doing if the installation will not have SMS credit, or wants email as a
fallback when SMS delivery fails — but if the goal is only "let the operator in this week", ADR-018's
path is the one that already exists, and this ADR should wait behind it.

## 8. Decisions needed from the owner

1. **Transport:** SMTP via the hosting mailbox, or an HTTP transactional email provider (§2)? The
   recommendation is the HTTP provider; naming it is an external decision like Zaman IT and aamarPay.
2. **Sender identity:** which address and domain sends, and who configures SPF, DKIM and DMARC for it?
3. **Risk acceptance:** is email an acceptable second factor for an account holding
   `medication.import`, for how long, and under whose name (§1, MAIL-009)?
4. **Scope of the channel:** operators only, or staff too? Patients are excluded either way (§1.3).

Until 1–3 are answered, MAIL-002 onwards should not start: each of them encodes one of those answers.
