# Technology Stack Contract

**Stage 3.1 rewrite (2026-09-17).** **Stage 3.2 update (2026-09-17):** Zaman IT SMS, aamarPay payments, JSON Schema validation for the medicine import, money handling, and mobile payment browser tab (§2, §4).
- **One choice per concern.** No "or equivalent" remains.
- **Versions** were read from the npm registry, pub.dev and Hostinger docs on 2026-09-17. `package.json` pins **exact** versions (no `^`/`~`), and lockfiles are committed. Renovate or manual upgrades go through a PR that runs the full CI.
- **Upgrades** that cross a major version need an audit row, or an ADR if they change a contract.

## 1. Runtime and workspace

| Area | Decision | Pinned version | Evidence / reason |
|---|---|---|---|
| Node.js | Node **24** LTS everywhere: hPanel "24.x", `.nvmrc`, `engines`, CI, Docker dev images | `.nvmrc` `24.21.0`; `engines.node` `">=24.0.0 <25"` | Newest LTS Hostinger supports (18/20/22/24, HOSTING-VERIFICATION #13). Node 24 Active LTS until 2026-10-20, maintenance until 2028-04-30. Fallback Node 22 (EOL 2027-04-30) if HOST-002 fails |
| Package manager | **pnpm** via Corepack (`packageManager` field) | `pnpm@12.4.2` | Hostinger detects pnpm from the lockfile (HOST-008 confirms the lockfile version is accepted; fallback: `pnpm deploy` + an npm-installable artifact branch) |
| Task runner | **Turborepo** | `turbo@2.10.13` | Cached `build`/`lint`/`test`/`typecheck` pipelines |
| Dart workspace | **Melos on Dart pub workspaces** (Melos ≥ 7 requires pub workspaces; one decision covers both) | `melos 8.7.0`; Dart SDK `^3.9.0` (Flutter stable pinned by FVM at MOB-001 to a release bundling Dart ≥ 3.9) | pub.dev 2026-09-09; the Melos migration guide requires Dart ≥ 3.9 for reliable pub workspaces |
| Language | **TypeScript** | `typescript@5.9.3` | `typescript-eslint@8.70.0` supports `<6.1.0`. TypeScript 7 (native port) is excluded until typescript-eslint and NestJS decorator support are confirmed |

## 2. Backend

| Area | Decision | Pinned version | Reason |
|---|---|---|---|
| Framework | **NestJS 11** + **Fastify** adapter | `@nestjs/core`/`@nestjs/common`/`@nestjs/platform-fastify`/`@nestjs/testing` `11.2.5`; `fastify` as resolved by `@nestjs/platform-fastify@11.2.5` (5.11.3) | NestJS 12 exists (`latest` 12.0.3, 11 is tagged `legacy`). **NestJS 11 is chosen because `nestjs-zod@5.5.0` peer-supports only `^10 \|\| ^11`**, and Zod 3 is mandated. Upgrading to 12 requires a Zod 4 migration ADR |
| Validation | **Zod 3** | `zod@3.25.76` (final 3.x) | Mandated by the brief. Zod 4 is `latest` (4.6.5); migration is Future (ADR required) |
| Nest ↔ Zod | **`nestjs-zod`** | `nestjs-zod@5.5.0` | `createZodDto`, `ZodValidationPipe`, `ZodSerializerInterceptor`. Maintained (2026-07-25), zod `^3.25 \|\| ^4`, Nest `^10 \|\| ^11`. Rejected: `@anatine/zod-nestjs` (stale since 2025-04), `zod-nestjs` (abandoned) |
| Zod → OpenAPI | **`@asteasolutions/zod-to-openapi`** | `7.3.4` (last Zod-3 line; **frozen upstream**, accepted risk) | One `OpenAPIRegistry` in `packages/contracts`: `OpenApiGeneratorV31` → `openapi.v1.json` (3.1.0, TypeScript clients); `OpenApiGeneratorV3` → `openapi.v1.oas30.json` (3.0.3, Dart). Verified locally (HOSTING-VERIFICATION §4). `@nestjs/swagger` is **not** used |
| OpenAPI 3.0 artifact | Generated directly by `OpenApiGeneratorV3` from the same registry | — | No downgrade tool needed. `@apiture/openapi-down-convert` rejected (self-described "not a fully robust tool") |
| ORM | **Prisma** with MariaDB driver adapter | `prisma@7.10.0`, `@prisma/client@7.10.0`, `@prisma/adapter-mariadb@7.10.0`, `mariadb@3.5.4` | Prisma 7 requires driver adapters, the `prisma-client` generator with `output`, and `prisma.config.ts`. **Do not install `prisma@latest`**: it resolves to `8.0.0-rc.15` |
| Database | **MariaDB**, series pinned to production (default 10.6 until HOST-001) | Docker `mariadb:10.6@sha256:<digest recorded at FOUND-004>` | ADR-014 |
| Jobs | **Database job queue** (ADR-015) | in-repo `packages/jobs` | Redis, BullMQ **removed** |
| Rate limits, OTP, idempotency | **Database tables** (ADR-015) | — | |
| Object storage | `ObjectStoragePort` + `S3CompatibleAdapter` (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` `3.1134.0`) + `PrivateDiskAdapter` | — | ADR-016. **MinIO local/CI only** (`minio/minio` image digest pinned at FOUND-005) |
| Malware scanning | `MalwareScanPort`: `MockMalwareScanner`, `BaselineContentPolicyScanner` (`file-type@22.1.1`, `sharp@0.35.4`, `pdf-lib@1.17.1`) | — | ADR-016 |
| Password hashing | **Argon2id** via `argon2@0.45.1` (prebuilt binaries) | — | HOST-002 verifies native load. Fallback `@node-rs/argon2@2.2.1` behind `PasswordHasherPort` |
| JWT | `jose@6.2.12` (EdDSA Ed25519 access tokens, `kid` rotation) | — | |
| UUID | **UUIDv7**, application-generated | `uuidv7@1.2.1` in `packages/kernel` | ADR-014 |
| Time | UTC `DATETIME(3)`; chamber local logic with `@js-temporal/polyfill@0.5.1` | — | |
| Phone numbers | `libphonenumber-js@1.13.13` (max metadata) | — | Bangladesh E.164 |
| PDF rendering | `pdfmake@0.3.11` with embedded Bangla-capable font (font license reviewed at RX-005) | — | Pure JS; no headless browser on Hostinger |
| Logging | **pino** (Stage 4: `nestjs-pino` **not used**; Fastify hooks + `PinoNestLogger` in `packages/http-kit` give request-scoped, redacted logs without `pino-http`, audit C-37) | `pino@10.3.1` | JSON to stdout (OBSERVABILITY.md) |
| Nest runtime peers (Stage 4) | `reflect-metadata` (decorator metadata for Nest DI), `rxjs` (Nest interceptors) | `reflect-metadata@0.2.2` (Apache-2.0), `rxjs@7.8.2` (Apache-2.0) | Required peers of `@nestjs/common`/`@nestjs/core@11.2.5` |
| Fastify (direct, Stage 4) | `fastify` declared directly by `packages/http-kit` for hook/request types, same version Nest resolves | `fastify@5.11.3` (MIT) | Avoids relying on a transitive dependency |
| Telemetry | OpenTelemetry Node SDK, OTLP/HTTP exporter **optional** (`OTEL_ENABLED`) | `@opentelemetry/sdk-node@0.222.0` (and matching exporters pinned at FOUND-008) | No vendor agent on Hostinger |
| AI SDKs | None in MVP adapters. `GeminiApiAdapter` and `OpenAICompatibleAdapter` use `fetch` (undici, built into Node 24) against documented REST APIs | — | Keeps vendor code in `packages/ai-adapters/*` small and auditable |
| SMS/OTP provider (Stage 3.2) | **Zaman IT** via `ZamanItSmsAdapter` using `fetch` (POST form body only; TLS verification never disabled) | no SDK | ADR-018 |
| Payment gateway (Stage 3.2) | **aamarPay** via `AamarPayGatewayAdapter` using `fetch` (HTTPS only). aamarPay's Flutter package and Android library are **rejected** (signature key on device) | no SDK | ADR-019 |
| Money (Stage 3.2) | kernel `Money` value object on integer paisa (`bigint`); DB `DECIMAL(12,2)`/`DECIMAL(14,2)`; API decimal strings | no decimal library | ADR-019 §5; `FLOAT`/`DOUBLE` forbidden |
| JSON Schema validation (Stage 3.2) | **Ajv** (`Ajv2020`) + formats, used only by the medication dataset importer | `ajv@8.20.0`, `ajv-formats@3.0.1` | Stage M schemas are JSON Schema 2020-12 (ADR-020) |
| Envelope encryption (Stage 3.2) | `packages/secrets` (`node:crypto` AES-256-GCM) shared by AI credentials and provider credentials | built-in | ADR-017 §4, ADR-018 §6 |

## 3. Web

| Area | Decision | Pinned version |
|---|---|---|
| UI | **React 19** + TypeScript | `react@19.3.0`, `react-dom@19.3.0` |
| Build | **Vite** (static output, Hostinger static site) | `vite@8.3.0`, `@vitejs/plugin-react@6.1.1` |
| Routing | **React Router** (data router, declarative mode) | `react-router@7.18.4` (v8 excluded until reviewed) |
| Server state | **TanStack Query** | `@tanstack/react-query@5.103.1` |
| API client | Generated TypeScript types plus a thin fetch client from `openapi.v1.json` | `openapi-typescript` and `openapi-fetch` pinned at WEB-001 |
| Auth transport | Access token **in memory**. Refresh cookie `__Host-hm_rt` **httpOnly, Secure, SameSite=Lax on `api.<domain>`**. CSRF signed double-submit for cookie-authenticated endpoints (ADR-013 §2) | — |
| E2E | **Playwright** | `@playwright/test@1.63.0` |
| Bangla font (Stage 4) | **Noto Sans Bengali** self-hosted from the bundle (no font CDN; CSP `font-src 'self'`) | `@fontsource/noto-sans-bengali@5.3.0` — OFL-1.1 (font-only license exception in `license:scan`) |
| React types (Stage 4, dev) | TypeScript declarations for React | `@types/react@19.3.0`, `@types/react-dom@19.3.0` — MIT |

## 4. Mobile

| Area | Decision | Version policy |
|---|---|---|
| Framework | Flutter stable, pinned with FVM in `mobile/.fvmrc` | **Flutter 3.44.8 / Dart 3.12.2** (MOB-001); packages declare `sdk: ^3.12.0` |
| Workspace | Melos 8.7.0 + pub workspaces (`mobile/pubspec.yaml` root with `workspace:` list; each package `resolution: workspace`). Melos is a pinned root dev dependency run as `dart run melos` | `melos@8.7.0` |
| State | Riverpod 3 | `flutter_riverpod@3.4.3` |
| HTTP | Dio 5 + generated Retrofit client | `dio@5.11.1`, `retrofit@4.10.0`, `json_annotation@4.12.0`; codegen (dev) `retrofit_generator@10.2.9`, `json_serializable@6.14.1`, `build_runner@2.15.1` (2.16 needs a `meta` newer than Flutter 3.44 pins) |
| OpenAPI client generator | **`swagger_parser` 1.44.3** consuming `openapi.v1.oas30.json` (3.0.3), with `json_serializable` + `retrofit` + `build_runner` | Verified locally: generation and `dart analyze` clean for 3.0.3 and 3.1.0 inputs (HOSTING-VERIFICATION §4) |
| Local store | Drift (SQLite), encrypted DB key in secure storage | exact at MOB-002 (`hm_offline` is not part of the Stage 4 shell) |
| Navigation | GoRouter | `go_router@17.5.0` (18.x depends on the unbundled `material_ui`/`cupertino_ui` packages, which need a newer Flutter than 3.44.8) |
| Secure storage | `flutter_secure_storage` | `flutter_secure_storage@11.2.0` |
| Lints (dev) | `flutter_lints` | `flutter_lints@6.0.0` |
| Mobile license scan (Stage 4) | `node scripts/mobile-license-scan.mjs` over `mobile/pubspec.lock` + pub cache LICENSE files; permissive only | in-repo |
| Payment browser (Stage 3.2) | `flutter_custom_tabs` (Android Custom Tabs / iOS SFSafariViewController); Android App Links / iOS Universal Links for `https://app.<domain>/payments/result/*` | exact at MOB-005 |
| Auth transport | Bearer access and refresh tokens in secure storage; no cookies | — |

## 5. Quality tooling

| Area | Decision | Pinned version |
|---|---|---|
| TS tests | **Vitest** | `vitest@5.0.1` |
| HTTP tests | **Supertest** against Nest Fastify app (`app.getHttpAdapter().getInstance()` after `ready()`) | `supertest@7.2.2` (MIT), `@types/supertest@7.2.1` (MIT) |
| DB tests | **Testcontainers** Node with `@testcontainers/mariadb@12.1.0` (Stage 4: the MariaDB module replaces `@testcontainers/mysql`; images `mariadb:10.6`/`mariadb:11.4` pinned by digest in CI) plus `mariadb@3.5.4` for raw test connections | `@testcontainers/mariadb@12.1.0`, `testcontainers@12.1.0` (MIT) |
| License scan (Stage 4) | `pnpm license:scan` (`scripts/license-scan.mjs` over `pnpm licenses list`): production permissive only, LGPL only for the unmodified `mariadb` connector, MPL/EPL only in dev tooling, OFL-1.1 only for the named web font package | in-repo | Stage 4 rule: every new dependency passes a license scan |
| Lint | **ESLint 10** (flat config only) + `typescript-eslint` + in-repo `eslint-plugin-hmedic` (rules: `no-raw-sql`, `no-append-only-mutation`, `lock-order`, `no-secret-logging`) | `eslint@10.10.0`, `typescript-eslint@8.70.0` |
| Format | **Prettier** | `prettier@3.9.7` |
| Biome | **Not used** | — |
| Boundaries | **dependency-cruiser** (rules in `REPOSITORY-STRUCTURE.md` §4) | `dependency-cruiser@18.3.1` |
| Dart lint/format | `dart format`, `flutter analyze` with `very_good_analysis` (pinned at MOB-001) | — |
| CI | **GitHub Actions** with actions pinned by full commit SHA | `CI-CD.md` |
| Secrets scan | `gitleaks` (binary pinned by checksum in CI) | — |
| Dependency audit | `pnpm audit --prod` + OSV-Scanner (pinned) | — |

## 6. Removed decisions (Stage 3 → 3.1)

| Removed | Replaced by |
|---|---|
| PostgreSQL 16 | MariaDB (ADR-014) |
| Redis 7 + BullMQ 5 | DB job queue (ADR-015) |
| MinIO in production | S3-compatible external adapter or verified private disk (ADR-016); MinIO local/CI only |
| "Vitest/Jest" | Vitest |
| "Biome or ESLint/Prettier" | ESLint + Prettier |
| "GitHub Actions or equivalent" | GitHub Actions |
| "React Query or equivalent" | TanStack Query |
| Node 22 baseline | Node 24 |
| `gen_random_uuid()` | Application UUIDv7 |
| Container/VM deployment | Hostinger managed Node.js apps (ADR-013) |

## 7. Provider-neutral boundaries (unchanged principle)

Ports are mandatory for auth, OTP, email, SMS, WhatsApp, push, video, AI, payments, object storage, malware scanning and backup destinations. Local development and CI use mocks only; **no paid credentials or real AI keys are required** to build, test or run the system.
