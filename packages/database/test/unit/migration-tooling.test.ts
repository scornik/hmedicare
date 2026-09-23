import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error untyped .mjs tooling
import { lintMigrations } from '../../scripts/lib/lint.mjs';
// @ts-expect-error untyped .mjs tooling
import { NORMALIZED_MARKER, normalizeMigration } from '../../scripts/lib/normalize.mjs';
// prettier-ignore
// @ts-expect-error untyped .mjs tooling
import { columnMeta, cumulativeSchema, migratedSectionNumbers, schemaForSections, splitSections } from '../../scripts/lib/schema-meta.mjs';

const pkg = path.resolve(__dirname, '../..');
const schema = readFileSync(path.join(pkg, 'prisma/schema.prisma'), 'utf8');
type Lint = (m: Array<{ name: string; sql: string }>) => string[];
const lint = lintMigrations as Lint;

function normalized(sql: string, name = 'x_9999_test') {
  return normalizeMigration({
    sql,
    name,
    ascii: new Map([['t', new Set(['id', 'tenant_id'])]]),
    constraintsDir: '/nonexistent',
  }) as string;
}

const TABLE = [
  'CREATE TABLE `t` (',
  '    `id` VARCHAR(36) NOT NULL,',
  '    `tenant_id` VARCHAR(36) NOT NULL,',
  '    `name` VARCHAR(20) NOT NULL,',
  '',
  '    PRIMARY KEY (`id`)',
  ') DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;',
].join('\n');

describe('schema sections', () => {
  it('splits the schema into the Stage 4 logical migrations', () => {
    const { sections } = splitSections(schema) as { sections: Array<{ number: string }> };
    // Backlog order, not numeric order: 0004 (Stage 5) was appended after 0016 (DATABASE §1.3).
    expect(sections.map((s) => s.number)).toEqual([
      '0001',
      '0002',
      '0003',
      '0014',
      '0015',
      '0016',
      '0004',
      '0005',
      '0006',
      '0007',
    ]);
    expect(cumulativeSchema(schema, '0001')).not.toContain('model Tenant ');
    expect(cumulativeSchema(schema, '0002')).toContain('model Tenant ');
  });

  it('builds the before/after schemas from the migrated set, not from numeric order (0004 after 0016)', () => {
    const dirs = ['202609180952_0001_platform_jobs', '202609180952_0016_sms', 'migration_lock.toml'];
    expect(migratedSectionNumbers(dirs)).toEqual(['0001', '0016']);
    const before = schemaForSections(schema, ['0001', '0016']);
    expect(before).toContain('model SmsBalanceSnapshot ');
    expect(before).not.toContain('model Patient ');
    const after = schemaForSections(schema, ['0001', '0016', '0004']);
    expect(after).toContain('model SmsBalanceSnapshot ');
    expect(after).toContain('model Patient ');
  });

  it('finds ascii columns from /// @ascii docs', () => {
    const { ascii } = columnMeta(schema) as { ascii: Map<string, Set<string>> };
    expect(ascii.get('users')?.has('id')).toBe(true);
    expect(ascii.get('users')?.has('display_name')).toBe(false);
  });
});

describe('normalizer', () => {
  it('adds InnoDB, the 520 collation and ascii_bin to marked columns only', () => {
    const out = normalized(TABLE);
    expect(out.startsWith(NORMALIZED_MARKER)).toBe(true);
    expect(out).toContain('`id` VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL');
    expect(out).toContain('`name` VARCHAR(20) NOT NULL');
    expect(out).toContain('ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci');
  });

  it('refuses to normalize twice', () => {
    expect(() => normalized(normalized(TABLE))).toThrow(/already normalized/);
  });
});

describe('migration lint (DATABASE-IMPLEMENTATION.md §1.3)', () => {
  it('passes every committed migration', () => {
    const dir = path.join(pkg, 'prisma/migrations');
    const migrations = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .map((name) => ({ name, sql: readFileSync(path.join(dir, name, 'migration.sql'), 'utf8') }));
    expect(migrations.length).toBeGreaterThanOrEqual(6);
    expect(lint(migrations)).toEqual([]);
  });

  it.each([
    ['trigger', 'CREATE TRIGGER t_bi BEFORE INSERT ON t FOR EACH ROW SET NEW.id = 1;', /triggers/],
    ['definer', 'CREATE DEFINER=`root`@`%` PROCEDURE p() BEGIN END;', /forbidden/],
    ['float money', 'ALTER TABLE `t` ADD COLUMN `amount` FLOAT NOT NULL;', /floating-point/],
    ['timestamp', 'ALTER TABLE `t` ADD COLUMN `at` TIMESTAMP NOT NULL;', /TIMESTAMP/],
    ['char id', 'ALTER TABLE `t` ADD COLUMN `ref` CHAR(36) NOT NULL;', /CHAR columns/],
    [
      '0900 collation',
      'ALTER TABLE `t` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;',
      /collations/,
    ],
  ])('rejects %s', (_label, extra, message) => {
    const problems = lint([{ name: 'bad', sql: `${normalized(TABLE)}\n${extra}` }]);
    expect(problems.join('\n')).toMatch(message);
  });

  it('rejects un-normalized files and non-ascii id columns', () => {
    const problems = lint([{ name: 'raw', sql: TABLE }]);
    expect(problems.join('\n')).toMatch(/not normalized/);
    expect(problems.join('\n')).toMatch(/ascii_bin/);
  });

  it('rejects a non-composite FK between two tenant-owned tables', () => {
    const second = TABLE.replace('`t`', '`u`');
    const sql = `${normalized(TABLE)}\n${normalized(second, 'x_9999_u').replace(NORMALIZED_MARKER, '')}\nALTER TABLE \`u\` ADD CONSTRAINT \`fk_u_t\` FOREIGN KEY (\`id\`) REFERENCES \`t\` (\`id\`);`;
    expect(lint([{ name: 'fk', sql }]).join('\n')).toMatch(/composite tenant FK/);
  });
});
