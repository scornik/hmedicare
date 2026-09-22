# ADR-022 — Prisma 6 with the Rust query engine, not Prisma 7's WebAssembly compiler

**Status:** Accepted (2026-09-22, Stage 5)
**Amends:** ADR-014 (database engine and client). Driver adapters and the ADR-014 session settings are kept.
**Driven by:** the production deployment target, recorded in `HOSTING-VERIFICATION.md` §5.1 (HOST-001).

## Context

The API is deployed to Hostinger's managed Node.js hosting, which runs the application under LiteSpeed's
Passenger wrapper (`lsnode`). Prisma 7 compiles queries through a WebAssembly module, and that module cannot
be instantiated there:

```
LinkError: WebAssembly.Instance(): Import #0 "./query_compiler_fast_bg.js"
  "__wbg_new_e17d9f43105b08be": function import requires a callable
```

The application itself is not at fault, and this was established rather than assumed:

- The WASM files on the server are **byte-identical** to local (sha256 compared, every variant).
- The same Node binary (v24.6.0) runs the same code successfully **outside** Passenger — `/health/ready`
  returns `db:ok` and a query completes in ~300 ms.
- It reproduces through both CommonJS and ESM, with and without the host's `--require` preload, and with and
  without the 512 MB heap cap.

Hostinger confirmed the wrapper cannot be disabled or bypassed on a managed plan; Passenger launches and
supervises the process by design, so running Node directly is a diagnostic, not a deployment mode.

Native addons are unaffected: another application on the same account runs Prisma 5 with
`libquery_engine-debian-openssl-3.0.x.so.node` and `sharp` under the same wrapper. The incompatibility is
specific to WebAssembly, which is consistent with `lsnode` snapshotting a pre-initialised process.

## Decision

**Pin Prisma to 6.19.3 and use the Rust library engine.** Driver adapters stay: Prisma 6 supports
`@prisma/adapter-mariadb` under the `driverAdapters` preview while planning queries with the native engine,
so the WebAssembly compiler is never loaded.

Keeping the adapter matters more than the version. It supplies `initSql`, which applies the ADR-014 session
settings — `sql_mode=STRICT_TRANS_TABLES`, `time_zone='+00:00'`, `innodb_lock_wait_timeout` — to every
connection. HOST-001 found the plan's server `sql_mode` is **not** strict, so those guarantees rest entirely
on that hook. Hostinger's own suggestion was to drop driver adapters; that would have silently removed
strict mode and left the queue engine on MariaDB's 50-second lock-wait default instead of our 5.

`binaryTargets = ["native", "rhel-openssl-1.1.x"]`: the plan is CloudLinux EL8 with OpenSSL 1.1.1k.

### Two consequences that needed fixing, not working around

1. **`@prisma/adapter-mariadb@6.19.3` misclassifies `ascii_bin` columns as `Bytes`.** It tests
   `field.flags & BINARY_FLAG`, and MariaDB sets that flag for any `_bin` collation — including the
   `ascii_bin` our ids use (`/// @ascii`). Version 7 tests the binary *charset* instead
   (`collation.index === 63`). The one-line upstream fix is backported in
   `patches/@prisma__adapter-mariadb@6.19.3.patch`. Without it every id read fails with
   `Conversion from Bytes to String failed`.

2. **The generated client no longer lives under `src/`.** With a custom `output` inside `src/`, `tsc -b`
   compiled Prisma's generated code into `dist/` and produced a second, broken copy
   (`Cannot read properties of undefined (reading 'DbNull')`). Prisma 6 generates into `node_modules` and is
   imported as `@prisma/client`, which is the idiomatic layout and keeps the engine binary resolvable at
   runtime from both `src` and `dist`.

## Consequences

- No WebAssembly in the query path, so the application runs under Passenger.
- The session-settings guarantee is unchanged, because the adapter is retained.
- A patched dependency to carry until the adapter is no longer needed. It is pinned by exact version, so a
  bump fails loudly rather than silently dropping the fix.
- Prisma 6 is a supported release, not an abandoned one, but it is a version behind. Revisit if the hosting
  moves to a runtime that can instantiate WebAssembly — a VPS or any host running Node directly — at which
  point Prisma 7 and this ADR can both be dropped.

## Exit

Reverted when the API no longer runs under Passenger. The revert is: unpin Prisma to 7.x, delete the patch,
and restore the `output` path if the generated client is wanted inside the package again.
