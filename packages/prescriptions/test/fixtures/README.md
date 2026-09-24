# `meddata-mini`

Two synthetic Stage M datasets, used by the medication-import integration tests.

Every medicine in them is invented. The brands (`Zentaxil`, `Brivolan`, `Corvexa Plus`, `Vetrizol`,
`Dolaprex`), the generics (`Paracetamoxin`, `Brivolane`, `Corvexadine`, `Dolaprexil`), the
manufacturers, the registration numbers and the prices do not name any real product, company or
publication, and the source URLs use `example.invalid`, a name reserved never to resolve. That is the
point: the real Stage M dataset is large, licence-encumbered and not in this repository, so the tests
that must run on every checkout run against this instead.

The five **schemas** in `schema/` are the real Stage M schema files, byte for byte, and their SHA-256s
are the ones pinned in `accepted-schemas.ts`. A fixture validated against a looser contract would prove
nothing about the importer that runs in production.

`-1` is the catalog. `-2` drops `Dolaprex Drops` and renames `Corvexa Plus` to `Corvexa Plus DS`, so a
second import has exactly one deactivation and exactly one update to report.

What the fixtures deliberately contain, beyond ordinary rows:

| Row | Why it is there |
| --- | --- |
| `Vetrizol 100` | Veterinary by both manufacturer marking and dosage form, so the exclusion is not resting on one field. |
| `Vetrizol Inj` alias | Points at the excluded product: must be counted as an unresolved target, not fail the run. |
| `Corvexa Plus` | Two generics, so generic links are written in order. |
| `জেনটাক্সিল ৫০০` | A Bangla brand name and a Bangla alias, so `medicationSearchKey` is exercised on combining marks. |
| `12.345` price | Three decimals against a `DECIMAL(12,2)` column: rejected, never rounded. |

Regenerate after editing the spec in the builder:

```bash
node packages/prescriptions/test/fixtures/build-meddata-mini.mjs
```

The builder rewrites the JSONL files and `checksums.sha256`; it hashes the schema files where they sit
and never rewrites them.
