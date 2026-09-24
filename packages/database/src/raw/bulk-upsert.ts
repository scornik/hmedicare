import type { Tx } from '../tx';

/**
 * Batched `INSERT … ON DUPLICATE KEY UPDATE` for bulk loaders.
 *
 * Lives here because raw SQL is confined to `packages/database/src/{locks,claims,engine,raw}`, and this
 * is genuinely something the ORM cannot express: Prisma's `upsert` is one row per round trip, and the
 * medication catalog is fifty thousand rows. At one statement each, an import that should take a minute
 * takes most of an hour, and every retry costs the same again.
 *
 * It is narrow on purpose. Table and column names are checked against a conservative pattern and quoted;
 * every value is bound as a parameter. A bulk loader is exactly the place where a hand-built string would
 * quietly become an injection surface, because the data comes from outside and nobody reads fifty
 * thousand rows.
 */
const IDENTIFIER = /^[a-z][a-z0-9_]{0,63}$/;

function quote(identifier: string, what: string): string {
  if (!IDENTIFIER.test(identifier)) {
    throw new Error(`bulk-upsert: refusing ${what} "${identifier}"; it is not a plain identifier`);
  }
  return `\`${identifier}\``;
}

export interface BulkUpsertOptions {
  table: string;
  /** Every column present in the rows, in a fixed order. */
  columns: readonly string[];
  /**
   * Columns to overwrite when the row already exists. Leave out anything that must survive a re-import —
   * `first_seen_version` is the reason this is a list rather than "everything but the key".
   */
  updateColumns: readonly string[];
  /**
   * Columns written **only when one of `updateColumns` actually differs** — `updated_at`, typically.
   *
   * Without this, a re-import of an unchanged dataset rewrites every timestamp and the rows are no longer
   * byte-identical, which is the property that makes "has this catalog changed?" answerable at all. The
   * comparison uses `<=>` rather than `<>` because a column that is NULL on both sides must count as
   * unchanged, and `NULL <> NULL` is NULL, not false.
   */
  touchColumns?: readonly string[];
  rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
}

/**
 * Writes one batch and returns the server's affected-row count.
 *
 * MariaDB reports 1 for an insert and 2 for an update that changed something, and 0 when the row was
 * already identical — which is what lets a caller distinguish inserted, updated and unchanged without
 * reading every row back first.
 */
export async function bulkUpsert(tx: Tx, options: BulkUpsertOptions): Promise<number> {
  const { table, columns, updateColumns, touchColumns = [], rows } = options;
  if (rows.length === 0) return 0;

  const t = quote(table, 'table');
  const cols = columns.map((c) => quote(c, 'column'));
  const updates = updateColumns.map((c) => {
    const q = quote(c, 'column');
    return `${q} = VALUES(${q})`;
  });
  if (updates.length === 0) {
    throw new Error('bulk-upsert: no update columns; use createMany when a conflict should be ignored');
  }

  if (touchColumns.length > 0) {
    const changed = updateColumns
      .map((c) => {
        const q = quote(c, 'column');
        return `NOT (${q} <=> VALUES(${q}))`;
      })
      .join(' OR ');
    // Assigned **before** the columns they compare, because MariaDB evaluates the assignments in
    // `ON DUPLICATE KEY UPDATE` left to right and a later one sees the values already written. Placed
    // last, `updated_at = IF(brand_name <=> VALUES(brand_name), …)` compares the new value with itself,
    // is always false, and the timestamp never moves — which looks exactly like perfect idempotence
    // until something genuinely changes and the catalog quietly fails to record that it did.
    updates.unshift(
      ...touchColumns.map((c) => {
        const q = quote(c, 'column');
        return `${q} = IF(${changed}, VALUES(${q}), ${q})`;
      }),
    );
  }

  const placeholders = rows.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
  const params: unknown[] = [];
  for (const row of rows) for (const c of columns) params.push(row[c] ?? null);

  const sql =
    `INSERT INTO ${t} (${cols.join(', ')}) VALUES ${placeholders} ` +
    `ON DUPLICATE KEY UPDATE ${updates.join(', ')}`;
  return tx.$executeRawUnsafe(sql, ...params);
}

/**
 * Marks rows not seen in this dataset version as inactive, in one statement per batch.
 *
 * Never deletes. A medication that disappears from a newer dataset may still be named on an approved
 * prescription from last year, and that prescription has to stay readable and renderable forever — so the
 * catalog only ever stops offering a row, it does not forget it.
 */
export async function deactivateMissing(
  tx: Tx,
  options: {
    table: string;
    versionColumn: string;
    version: string;
    deactivatedColumn: string;
    limit: number;
  },
): Promise<number> {
  const t = quote(options.table, 'table');
  const v = quote(options.versionColumn, 'column');
  const d = quote(options.deactivatedColumn, 'column');
  return tx.$executeRawUnsafe(
    `UPDATE ${t} SET active = 0, ${d} = ? WHERE ${v} <> ? AND active = 1 AND is_synthetic = 0 LIMIT ?`,
    options.version,
    options.version,
    options.limit,
  );
}
