// Which files in an installed dependency tree are compiled binaries rather than JavaScript or metadata.
//
// Separate from `fix-native-exec-bits.mjs` so it can be tested: that script walks the real `node_modules`
// and chmods as a side effect of being imported, and this predicate is the part that has been wrong twice.
// Each miss cost a deployment, and the names are easy to get subtly wrong — `schema-engine-...` carries no
// extension at all, while the query engine is `libquery_engine-....so.node`.

/**
 * True for a compiled engine or launcher.
 *
 * Deliberately narrow. The caller only ever applies it inside `bin/` directories and known engine
 * folders, so a false positive here cannot make arbitrary data executable, but a pattern loose enough to
 * match `package.json` would still be a bug worth avoiding.
 */
export function isNativeBinary(file) {
  return (
    file === 'turbo' ||
    /^(lib)?query[-_]engine.*\.node$/.test(file) ||
    file.endsWith('.so.node') ||
    // The standalone engine executables, which carry no extension: `schema-engine-debian-openssl-1.1.x`
    // and the query engine's CLI-side twin.
    /^(schema|query|migration)-engine-[a-z0-9.-]+$/.test(file)
  );
}
