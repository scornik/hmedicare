// Migration lint (DATABASE-IMPLEMENTATION.md §1.3, ADR-014). Pure function over SQL text so it is unit-testable.
import { NORMALIZED_MARKER } from './normalize.mjs';

const FORBIDDEN = [
  [
    /CREATE\s+(DEFINER\s*=\s*\S+\s+)?(TRIGGER|PROCEDURE|FUNCTION|EVENT)\b/i,
    'triggers/procedures/functions/events are forbidden (Hostinger, ADR-014)',
  ],
  [/\bDEFINER\s*=/i, 'DEFINER clauses are forbidden'],
  [/`\s+(FLOAT|DOUBLE|REAL)\b/i, 'floating-point columns are forbidden (money must be DECIMAL)'],
  [/`\s+TIMESTAMP\b/i, 'TIMESTAMP columns are forbidden (use DATETIME(3) UTC)'],
  [/`\s+CHAR\(/i, 'CHAR columns are forbidden (use VARCHAR; generated columns reject CHAR sources)'],
  [/utf8mb4_0900_ai_ci|uca1400/i, 'MySQL-8/11.x-only collations are forbidden on the 10.6 floor'],
];

/**
 * @param {Array<{ name: string, sql: string }>} migrations in apply order
 * @returns {string[]} problems
 */
export function lintMigrations(migrations) {
  const problems = [];
  const tenantTables = new Set();
  for (const { name, sql } of migrations) {
    if (!sql.startsWith(NORMALIZED_MARKER))
      problems.push(`${name}: not normalized (run db:migration:normalize)`);
    for (const [re, message] of FORBIDDEN) if (re.test(sql)) problems.push(`${name}: ${message}`);

    for (const m of sql.matchAll(/CREATE TABLE `([a-z0-9_]+)` \(([\s\S]*?)\n\)([^;]*);/g)) {
      const [, table, body, tail] = m;
      if (!/ENGINE=InnoDB/.test(tail)) problems.push(`${name}: ${table} must be ENGINE=InnoDB`);
      if (!/utf8mb4 COLLATE utf8mb4_unicode_520_ci/.test(tail)) {
        problems.push(`${name}: ${table} must use utf8mb4 / utf8mb4_unicode_520_ci`);
      }
      if (/^\s+`tenant_id` /m.test(body)) tenantTables.add(table);
      for (const col of body.matchAll(/^\s+`((?:[a-z0-9_]+_)?id)` VARCHAR\((\d+)\)([^,\n]*)/gm)) {
        const [, colName, len, rest] = col;
        if (colName === 'key_id') continue; // KEK key identifier, not an entity id
        if (len !== '36') problems.push(`${name}: ${table}.${colName} id columns must be VARCHAR(36)`);
        if (!/ascii_bin/.test(rest))
          problems.push(`${name}: ${table}.${colName} id columns must be ascii_bin`);
      }
    }
    for (const m of sql.matchAll(/ALTER TABLE `([a-z0-9_]+)` ADD COLUMN `tenant_id`/g))
      tenantTables.add(m[1]);

    // Composite tenant FK rule: tenant-owned → tenant-owned must include tenant_id on both sides.
    for (const fk of sql.matchAll(
      /ALTER TABLE `([a-z0-9_]+)` ADD CONSTRAINT `([a-z0-9_]+)` FOREIGN KEY \(([^)]*)\) REFERENCES `([a-z0-9_]+)` \(([^)]*)\)/g,
    )) {
      const [, from, fkName, cols, to, refCols] = fk;
      if (from === 'tenants' || to === 'tenants') continue;
      if (tenantTables.has(from) && tenantTables.has(to)) {
        if (!cols.includes('`tenant_id`') || !refCols.includes('`tenant_id`')) {
          problems.push(
            `${name}: ${fkName} must be a composite tenant FK (tenant_id, x) → ${to}(tenant_id, id)`,
          );
        }
      }
    }
    for (const gen of sql.matchAll(/ADD COLUMN `([a-z0-9_]+)` [^;]* AS \(([^;]*)\)\s*(\w+)?;/g)) {
      if (gen[3] !== 'PERSISTENT') problems.push(`${name}: generated column ${gen[1]} must be PERSISTENT`);
    }
  }
  return problems;
}
