import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import {
  IMPORTED_FILES,
  type ImportedFile,
  SCHEMA_FOR_FILE,
  type SchemaSet,
  matchSchemaSet,
} from './accepted-schemas';

/**
 * Reading a Stage M dataset directory: checksums, schema pinning, and streaming validated lines.
 *
 * Nothing here writes to the database. Preflight has to be able to refuse a dataset before a single row
 * is touched — a checksum that does not match, or a schema this importer was not written against, means
 * the safest thing that can happen is nothing at all.
 */
export class DatasetError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DatasetError';
  }
}

export interface PreflightResult {
  version: string;
  /** From the dataset's own records; `UNVERIFIED` for `medicine-dataset-20260917-4`. */
  datasetStatus: string;
  schemaSet: SchemaSet;
  fileChecksums: Record<string, string>;
  schemaHashes: Record<string, string>;
  /** Lines per imported file, for the report and for progress. */
  lineCounts: Record<string, number>;
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function countLines(file: string): Promise<number> {
  let n = 0;
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) n += 1;
  return n;
}

export class DatasetReader {
  private readonly validators = new Map<string, ValidateFunction>();

  constructor(private readonly dir: string) {}

  private file(name: string): string {
    return path.join(this.dir, name);
  }

  /**
   * Verifies the dataset before anything is written.
   *
   * Every file listed in `checksums.sha256` is hashed, not just the ones this importer reads: the
   * manifest describes one artefact, and a dataset with a tampered `conflicts.jsonl` is a dataset whose
   * provenance nobody should trust, even though nothing imports that file.
   */
  async preflight(expectedVersion: string): Promise<PreflightResult> {
    const manifest = await readFile(this.file('checksums.sha256'), 'utf8').catch(() => {
      throw new DatasetError('MEDDATA_MANIFEST_MISSING', `no checksums.sha256 in ${this.dir}`);
    });

    const listed = manifest
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [hash, ...rest] = l.split(/\s+/);
        return { hash: hash ?? '', name: rest.join(' ') };
      });
    if (listed.length === 0) {
      throw new DatasetError('MEDDATA_MANIFEST_EMPTY', 'checksums.sha256 lists no files');
    }

    const fileChecksums: Record<string, string> = {};
    for (const entry of listed) {
      const full = this.file(entry.name);
      const info = await stat(full).catch(() => null);
      if (!info?.isFile()) {
        throw new DatasetError('MEDDATA_CHECKSUM_MISMATCH', `${entry.name} is listed but missing`);
      }
      const actual = await sha256File(full);
      if (actual !== entry.hash) {
        throw new DatasetError('MEDDATA_CHECKSUM_MISMATCH', `${entry.name} does not match its checksum`);
      }
      fileChecksums[entry.name] = actual;
    }

    const schemaHashes: Record<string, string> = {};
    for (const file of IMPORTED_FILES) {
      const schema = SCHEMA_FOR_FILE[file];
      const hash = fileChecksums[`schema/${schema}`] ?? fileChecksums[schema];
      if (!hash) {
        throw new DatasetError('MEDDATA_SCHEMA_UNSUPPORTED', `${schema} is not in the manifest`);
      }
      schemaHashes[schema] = hash;
    }
    const schemaSet = matchSchemaSet(schemaHashes);
    if (!schemaSet) {
      // Deliberately not "close enough". A schema this importer was not written against may permit rows
      // the mapping silently mishandles, and validation would pass the whole way.
      throw new DatasetError(
        'MEDDATA_SCHEMA_UNSUPPORTED',
        'the dataset ships schemas this importer has not been reviewed against; ' +
          'update accepted-schemas.ts with an ADR-020 amendment',
      );
    }

    const lineCounts: Record<string, number> = {};
    for (const file of IMPORTED_FILES) lineCounts[file] = await countLines(this.file(file));

    // The dataset's own status, read from its records rather than from `latest.json`, which is
    // informational and can name a version this directory does not contain.
    const firstMedication = await this.firstRecord('medications.jsonl');
    const datasetStatus =
      typeof (firstMedication as { status?: unknown })?.status === 'string'
        ? (firstMedication as { status: string }).status
        : 'UNVERIFIED';

    return { version: expectedVersion, datasetStatus, schemaSet, fileChecksums, schemaHashes, lineCounts };
  }

  private async firstRecord(file: ImportedFile): Promise<unknown> {
    const rl = createInterface({ input: createReadStream(this.file(file)), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      rl.close();
      return JSON.parse(line);
    }
    return null;
  }

  /** The compiled validator for one file's schema, from the schema shipped in the dataset. */
  private async validator(file: ImportedFile): Promise<ValidateFunction> {
    const name = SCHEMA_FOR_FILE[file];
    const cached = this.validators.get(name);
    if (cached) return cached;
    const schema: unknown = JSON.parse(await readFile(this.file(path.join('schema', name)), 'utf8'));
    // `strict: true` so a schema keyword Ajv does not understand is an error rather than a silent no-op;
    // `allErrors: false` because the first failure is enough to reject a line and the rest is cost.
    const ajv = new Ajv2020({ strict: true, allErrors: false });
    addFormats(ajv as never);
    const compiled = ajv.compile(schema as object);
    this.validators.set(name, compiled);
    return compiled;
  }

  /**
   * Streams validated records from one file, starting after `fromLine`.
   *
   * Yields `{ line, record }` for valid rows and `{ line, error }` for rejected ones, rather than
   * throwing: one malformed line in fifty thousand should be counted and reported, not abort an import
   * that has already written most of a catalog. A documented threshold turns that into a failure.
   */
  async *read(
    file: ImportedFile,
    fromLine = 0,
  ): AsyncGenerator<{ line: number; record?: unknown; error?: string }> {
    const validate = await this.validator(file);
    const rl = createInterface({ input: createReadStream(this.file(file)), crlfDelay: Infinity });
    let line = 0;
    for await (const raw of rl) {
      if (!raw.trim()) continue;
      line += 1;
      if (line <= fromLine) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        yield { line, error: 'MALFORMED_JSON' };
        continue;
      }
      if (!validate(parsed)) {
        yield { line, error: validate.errors?.[0]?.message ?? 'SCHEMA_REJECTED' };
        continue;
      }
      yield { line, record: parsed };
    }
  }
}
