import { parseArgs } from 'node:util';
import { createDatabase } from '@hmedic/database';
import { REQUIRED_GATE_CODES, type GateCode } from '../infrastructure/medication-catalog-admin';

/**
 * `pnpm meddata:status [--json]` — what is in the catalog, what was imported, and which dataset-card
 * gates are attested (ADR-020 §2).
 *
 * Read-only, and deliberately so. Recording an attestation is a person putting their name and their
 * evidence against a review they actually did; it happens through
 * `POST /admin/medications/gates` as an authenticated platform operator, where it is audited and
 * hash-chained. A CLI that could write one would be a way to tick four boxes without anyone reviewing
 * anything, which is the exact failure the gates exist to prevent. So this command answers "where do we
 * stand" and nothing else.
 *
 * The production verdict at the bottom is the same rule the importer applies, read from the same two
 * inputs, so an operator can see the refusal before they trigger an import rather than after.
 */
interface GateRow {
  gateCode: GateCode;
  attested: boolean;
  recordedAt: string | null;
  recordedByUserId: string | null;
  evidenceRef: string | null;
}

const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const shortDate = (d: Date | null) => (d ? d.toISOString().replace('T', ' ').slice(0, 16) : '—');

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { json: { type: 'boolean' }, version: { type: 'string' } } });
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('usage: meddata:status [--json] [--version <name>]\nDATABASE_URL is required.\n');
    return 2;
  }

  const appEnv = process.env.APP_ENV ?? 'development';
  const productionAllowed = process.env.MEDICATION_IMPORT_PRODUCTION_ALLOWED === 'true';
  const db = createDatabase({ url, poolMax: 2 });

  try {
    const catalog = await db.prisma.medication.groupBy({
      by: ['datasetVersion'],
      _count: { _all: true },
      orderBy: { datasetVersion: 'asc' },
    });
    const activeByVersion = await db.prisma.medication.groupBy({
      by: ['datasetVersion'],
      where: { active: true },
      _count: { _all: true },
    });
    const activeMap = new Map(activeByVersion.map((r) => [r.datasetVersion, r._count._all]));

    const imports = await db.prisma.medicationDatasetImport.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // Every version this installation has heard of, whether it imported or only tried.
    const versions = [
      ...new Set([
        ...catalog.map((c) => c.datasetVersion),
        ...imports.map((i) => i.datasetVersion),
        ...(values.version ? [values.version] : []),
      ]),
    ].sort();

    const attestations = await db.prisma.medicationDatasetGateAttestation.findMany({
      orderBy: { seq: 'asc' },
    });

    const gatesFor = (version: string): GateRow[] =>
      REQUIRED_GATE_CODES.map((gateCode) => {
        const row = attestations.find((a) => a.datasetVersion === version && a.gateCode === gateCode);
        return {
          gateCode,
          attested: row !== undefined,
          recordedAt: row?.recordedAt.toISOString() ?? null,
          recordedByUserId: row?.recordedByUserId ?? null,
          evidenceRef: row?.evidenceRef ?? null,
        };
      });

    const report = {
      environment: appEnv,
      productionImportAllowedFlag: productionAllowed,
      catalog: catalog.map((c) => ({
        datasetVersion: c.datasetVersion,
        rows: c._count._all,
        active: activeMap.get(c.datasetVersion) ?? 0,
      })),
      imports: imports.map((i) => ({
        importId: i.id,
        datasetVersion: i.datasetVersion,
        status: i.status,
        executionPath: i.executionPath,
        environment: i.environment,
        errorClass: i.errorClass,
        refusalReason: i.refusalReason,
        requestedBy: i.requestedBy,
        createdAt: i.createdAt.toISOString(),
      })),
      gates: versions.map((v) => {
        const gates = gatesFor(v);
        const missing = gates.filter((g) => !g.attested).map((g) => g.gateCode);
        return {
          datasetVersion: v,
          gates,
          missing,
          allAttested: missing.length === 0,
          productionImportWouldBe: missing.length === 0 && productionAllowed ? 'ALLOWED' : 'REFUSED',
        };
      }),
    };

    if (values.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return 0;
    }

    const out: string[] = [];
    out.push(`Medication catalog — ${appEnv}`);
    out.push('');

    out.push('Catalog');
    if (report.catalog.length === 0) {
      out.push('  (empty — free-text prescribing still works)');
    } else {
      for (const c of report.catalog) {
        out.push(
          `  ${pad(c.datasetVersion, 32)} ${String(c.rows).padStart(7)} rows  ${String(c.active).padStart(7)} active`,
        );
      }
    }
    out.push('');

    out.push('Recent imports');
    if (report.imports.length === 0) {
      out.push('  (none)');
    } else {
      for (const i of imports) {
        const note = i.refusalReason ?? i.errorClass ?? '';
        out.push(
          `  ${shortDate(i.createdAt)}  ${pad(i.status, 9)} ${pad(i.executionPath, 4)} ` +
            `${pad(i.datasetVersion, 32)} ${note}`,
        );
      }
    }
    out.push('');

    out.push('Dataset-card gates (ADR-020 §2)');
    for (const v of report.gates) {
      out.push(`  ${v.datasetVersion}`);
      for (const g of v.gates) {
        const mark = g.attested ? 'ATTESTED' : 'open';
        const who = g.attested ? `  ${shortDate(new Date(g.recordedAt!))}  by ${g.recordedByUserId}` : '';
        out.push(`    [${g.attested ? 'x' : ' '}] ${pad(g.gateCode, 28)} ${pad(mark, 9)}${who}`);
      }
      out.push(
        `    → a production import of this version would be ${v.productionImportWouldBe}` +
          (v.missing.length > 0 ? ` (missing: ${v.missing.join(', ')})` : ''),
      );
      out.push('');
    }

    out.push(
      `MEDICATION_IMPORT_PRODUCTION_ALLOWED=${productionAllowed}. Production needs this *and* all four ` +
        'gates attested for that exact version; either one alone refuses.',
    );
    process.stdout.write(`${out.join('\n')}\n`);
    return 0;
  } finally {
    await db.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(`${String((e as Error)?.message ?? e).slice(0, 400)}\n`);
    process.exit(1);
  });
