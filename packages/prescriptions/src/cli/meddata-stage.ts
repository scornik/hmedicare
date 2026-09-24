import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DatasetReader } from '../infrastructure/medication-import/dataset-reader';

/**
 * `pnpm meddata:stage --dir <dataset directory> [--root <storage root>] [--force]`
 * (ADR-020 §3, MEDDATA-003).
 *
 * Puts a verified dataset where the server can read it, so that a later
 * `POST /admin/medications/imports {datasetVersion}` has something to import. Staging and importing are
 * separate on purpose: moving a few hundred megabytes over SFTP is slow and interruptible, and an import
 * that discovers a half-copied file after writing twenty thousand rows is the failure this split exists
 * to prevent.
 *
 * The destination is `<STORAGE_DISK_ROOT>/<MEDICATION_DATASET_STORAGE_PREFIX><version>/`. This is the
 * disk adapter path from ADR-020 §3; the S3 path arrives with the object-storage port in Stage 8, and
 * until then an operator on a host without a shared filesystem stages by SFTP into the same directory,
 * which is why the layout is fixed here rather than invented by whoever copies the files.
 *
 * What it refuses:
 *   - a dataset whose own `checksums.sha256` does not verify, or whose schemas this importer has not
 *     been reviewed against — there is no point moving a dataset the importer will reject;
 *   - a destination inside a web root, because a staged dataset under `public_html` is a public
 *     download of a licence-encumbered file;
 *   - overwriting a version that is already staged, unless `--force`. A staged version is what a
 *     recorded import refers to; replacing its bytes silently would make that record a lie.
 */
const DEFAULT_PREFIX = 'platform/medicine-datasets/';
const DEFAULT_FORBIDDEN = 'public_html,hbuilds';

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** Every file under `dir`, as paths relative to it, sorted. */
async function walk(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string' },
      version: { type: 'string' },
      root: { type: 'string' },
      force: { type: 'boolean' },
    },
  });

  const root = values.root ?? process.env.STORAGE_DISK_ROOT;
  if (!values.dir || !root) {
    process.stderr.write(
      'usage: meddata:stage --dir <dataset directory> [--version <name>] [--root <storage root>]\n' +
        '       [--force]\n' +
        'The root defaults to STORAGE_DISK_ROOT. The version defaults to the directory name.\n',
    );
    return 2;
  }

  const from = path.resolve(process.env.INIT_CWD ?? process.cwd(), values.dir);
  const version = values.version ?? path.basename(from);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(version)) {
    process.stderr.write(
      `meddata:stage: refusing version "${version}"; it must be a plain name, since it becomes a path\n`,
    );
    return 2;
  }

  const absoluteRoot = path.resolve(root);
  const forbidden = (process.env.STORAGE_DISK_FORBIDDEN_ROOTS ?? DEFAULT_FORBIDDEN)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const segments = absoluteRoot.split(/[\\/]+/);
  const offending = forbidden.find((f) => segments.includes(f));
  if (offending) {
    process.stderr.write(
      `meddata:stage: refusing to stage under "${absoluteRoot}"; it is inside "${offending}", ` +
        'which is served over HTTP. A staged dataset there is a public download.\n',
    );
    return 2;
  }

  // Verified before it is copied, not after. Staging a dataset the importer would reject wastes an
  // operator's evening and, worse, leaves something import-shaped sitting where a later run will find it.
  const reader = new DatasetReader(from);
  let preflight;
  try {
    preflight = await reader.preflight(version);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    process.stderr.write(
      `meddata:stage: ${err.code ?? 'DATASET_INVALID'}: ${String(err.message ?? e).slice(0, 400)}\n`,
    );
    return 1;
  }

  const prefix = process.env.MEDICATION_DATASET_STORAGE_PREFIX ?? DEFAULT_PREFIX;
  const to = path.join(absoluteRoot, ...prefix.split('/').filter(Boolean), version);
  const already = await stat(to).catch(() => null);
  if (already?.isDirectory() && !values.force) {
    process.stderr.write(
      `meddata:stage: ${version} is already staged at ${to}.\n` +
        'An import that has already recorded this version refers to those exact bytes. ' +
        'Pass --force only if you are sure nothing has imported it yet.\n',
    );
    return 2;
  }

  const files = await walk(from);
  for (const file of files) {
    const target = path.join(to, ...file.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(from, ...file.split('/')), target);
  }

  // Re-hashed where it landed. A copy that truncated, or a disk that filled, is caught here rather than
  // twenty thousand rows into an import that then has to be resumed.
  const staged = new DatasetReader(to);
  try {
    await staged.preflight(version);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    process.stderr.write(
      `meddata:stage: the copy at ${to} does not verify ` +
        `(${err.code ?? 'DATASET_INVALID'}: ${String(err.message ?? e).slice(0, 200)}). ` +
        'Remove it and stage again.\n',
    );
    return 1;
  }

  // Spot-checked byte for byte as well: `checksums.sha256` covers the files it lists, and a copy that
  // also dropped an unlisted file would pass preflight while being a different artefact.
  for (const file of files) {
    const a = await sha256File(path.join(from, ...file.split('/')));
    const b = await sha256File(path.join(to, ...file.split('/')));
    if (a !== b) {
      process.stderr.write(`meddata:stage: ${file} differs after copying. Remove ${to} and try again.\n`);
      return 1;
    }
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        event: 'MEDDATA_STAGED',
        datasetVersion: version,
        datasetStatus: preflight.datasetStatus,
        schemaSet: preflight.schemaSet.id,
        stagedAt: to,
        files: files.length,
        lines: preflight.lineCounts,
        next: `POST /admin/medications/imports {"datasetVersion":"${version}"}`,
      },
      null,
      2,
    )}\n`,
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch(() => process.exit(1));
