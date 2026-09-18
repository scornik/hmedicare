# Telemedicine Implementation Contract

**Stage 3.1 update (2026-09-17).**
- The platform origin on Hostinger does not accept inbound WebSockets (ADR-013), so signaling and media are hosted by the selected video provider.
- Participant events use provider webhooks or client-reported HTTP events.
- Routes: `API-IMPLEMENTATION.md` §3.9. Tables: `DATABASE-IMPLEMENTATION.md` migration 0012.

## 1. Provider port

- `TelemedicineProvider` implements `createSession`, `issueParticipantToken`, `endSession` and `recordParticipantEvent`.
- The API stores a `telemedicine_sessions` row, linked to an encounter, in a `PENDING` state **before** calling the provider (outside the transaction). It then commits `ACTIVE` or `FAILED`.
- The platform requires no self-hosted media server (mediasoup/TURN are not deployable on the host). Provider selection must include TURN/ICE.

## 2. Authorization

- **Session creation** requires `telemedicine.start`, assignment to the encounter, and an active remote encounter.
- **Join token** requires one of:
  - `telemedicine.join` (staff/doctor with assignment or scope);
  - a patient context with `JOIN_TELEMEDICINE` authority for that encounter's patient (self or guardian, AUTHORIZATION-MATRIX §4).
- **Token lifetime:** short TTL; provider credentials remain server-side.
- **Session expiry** stops join-token issuance but does not automatically complete the encounter.

## 3. Reconnection and fallback

- Record `ParticipantJoined`, `ParticipantLeft` and reconnect events. Duplicate provider event ids are ignored.
- Temporary network loss does not end an encounter, and the client can request a refreshed token.
- Low-bandwidth mode disables video while preserving audio and chat.
- Audio-only is available without creating a separate clinical encounter.
- Clients learn session state by polling (no server push channel): staff via `GET /encounters/{id}`, patients via `GET /serials/{id}` or `GET /me/serials`.

## 4. Recording

- Recording is disabled by default and is not part of MVP.
- If it is ever enabled, it requires:
  - explicit consent;
  - storage-port metadata (ADR-016);
  - a retention policy;
  - access authorization;
  - audit;
  - legal and clinical review.

## 5. Mock adapter tests

- The mock session provider supports these scenarios:
  - session create;
  - token expiry;
  - unauthorized participant;
  - provider timeout (session → `FAILED`, encounter unaffected);
  - participant events;
  - duplicate event ids;
  - end-session failure.
- No real video credential is required to pass CI.
