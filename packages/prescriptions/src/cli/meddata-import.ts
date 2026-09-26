import { existsSync } from 'node:fs';
import { userInfo } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createDatabase } from '@hmedic/database';

import { DatasetReader } from '../infrastructure/medication-import/dataset-reader';
import { MedicationImporter } from '../infrastructure/medication-import/importer';

// Read the repository .env the way `pnpm db:seed` and `pnpm db:reset` do, so this works from a plain
// shell rather than only from one where someone remembered to source it. Variables already exported
// win, because `loadEnvFile` never overwrites — an explicit DATABASE_URL still points where it says.
const repoEnv = path.resolve(__dirname, '../../../../.env');
if (existsSync(repoEnv)) process.loadEnvFile(repoEnv);

/**
 * `pnpm meddata:import --dir tools/medicine-data/dist/<version> [--dry-run]`
 * (PRESCRIPTION-IMPLEMENTATION.md §5.4, ADR-020 §3).
 *
 * The local and dev path. It reads dataset files from disk and writes to the configured database; it
 * imports no code from `tools/`, because the dataset is data this system consumes rather than a module it
 * depends on, and a build tool should not become a runtime dependency of the catalog.
 *
 * It refuses `APP_ENV=production` outright. Production imports go through the admin route, where the
 * attestation gate lives and where the operator is an authenticated platform user rather than whoever
 * happens to hold a shell.
 */
async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string' },
      version: { type: 'string' },
      'dry-run': { type: 'boolean' },
      force: { type: 'boolean' },
      'include-veterinary': { type: 'boolean' },
    },
  });
  const url = process.env.DATABASE_URL;
  const dir = values.dir;
  if (!url || !dir) {
    process.stderr.write(
      'usage: meddata:import --dir <dataset directory> [--version <name>] [--dry-run]\n' +
        '       [--include-veterinary]\n' +
        'DATABASE_URL is required. The version defaults to the directory name.\n',
    );
    return 2;
  }
  const appEnv = process.env.APP_ENV ?? 'development';
  if (appEnv === 'production') {
    process.stderr.write(
      'meddata:import refuses to run with APP_ENV=production.\n' +
        'Stage the dataset and use POST /admin/medications/imports, where the attestation gate applies.\n',
    );
    return 2;
  }
  // pnpm runs a workspace script with the package as the working directory, so a path the operator typed
  // relative to the repository root would not resolve. `INIT_CWD` is where they actually were.
  const resolved = path.resolve(process.env.INIT_CWD ?? process.cwd(), dir);
  if (!existsSync(resolved)) {
    process.stderr.write(`meddata:import: no dataset directory at ${resolved}\n`);
    return 2;
  }

  const datasetVersion = values.version ?? path.basename(resolved);
  const db = createDatabase({ url, poolMax: 4 });
  const started = Date.now();
  try {
    const importer = new MedicationImporter(db.prisma, new DatasetReader(resolved));
    const result = await importer.run({
      datasetVersion,
      environment: appEnv,
      executionPath: 'CLI',
      requestedBy: `cli:${userInfo().username}`.slice(0, 128),
      dryRun: values['dry-run'] ?? false,
      force: values.force ?? false,
      excludeVeterinary: !values['include-veterinary'],
      onProgress: ({ line, counts }) => {
        // One line per batch, overwritten, so a fifty-thousand-row import shows progress without
        // producing a thousand lines of scrollback.
        if (process.stdout.isTTY) {
          process.stdout.write(
            `\rmedications: ${line} read, ${counts.excludedVeterinary} veterinary excluded`,
          );
        }
      },
    });
    if (process.stdout.isTTY) process.stdout.write('\r\x1b[K');
    process.stdout.write(`${JSON.stringify({ ...result, datasetVersion }, null, 2)}\n`);
    return result.status === 'SUCCEEDED' ? 0 : 1;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    process.stderr.write(
      `${JSON.stringify({
        event: 'MEDDATA_IMPORT_FAILED',
        code: err.code ?? 'IMPORT_ERROR',
        message: String(err.message ?? e).slice(0, 400),
        seconds: Math.round((Date.now() - started) / 1000),
      })}\n`,
    );
    return 1;
  } finally {
    await db.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch(() => process.exit(1));
