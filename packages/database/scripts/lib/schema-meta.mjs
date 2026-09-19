// Parses prisma/schema.prisma for the migration tooling (DATABASE-IMPLEMENTATION.md §1.3):
// - sections: `// ---------------- NNNN name` markers group models into logical migrations;
// - ascii columns: fields documented with `/// @ascii` become `CHARACTER SET ascii COLLATE ascii_bin`.
import { readFileSync } from 'node:fs';

const SECTION_RE = /^\/\/ -{8,} (\d{4}) ([a-z_]+)/;

export function readSchema(path) {
  return readFileSync(path, 'utf8');
}

/** Splits the schema into { header, sections: [{ number, name, body }] }. */
export function splitSections(schema) {
  const lines = schema.split('\n');
  const header = [];
  const sections = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(SECTION_RE);
    if (m) {
      current = { number: m[1], name: m[2], lines: [line] };
      sections.push(current);
      continue;
    }
    if (current) current.lines.push(line);
    else header.push(line);
  }
  return {
    header: header.join('\n'),
    sections: sections.map((s) => ({ number: s.number, name: s.name, body: s.lines.join('\n') })),
  };
}

/** Builds a schema containing the header and the sections up to and including `number`. */
export function cumulativeSchema(schema, number) {
  const { header, sections } = splitSections(schema);
  const included = number === null ? [] : sections.filter((s) => s.number <= number);
  return [header, ...included.map((s) => s.body)].join('\n');
}

/**
 * Builds the schema made of exactly the sections in `numbers` (any order). Migrations are created in backlog
 * order, not numeric order (DATABASE-IMPLEMENTATION §1.3), so the "before" schema of a new migration is the set
 * of sections that already have a migration directory, whatever their numbers.
 */
export function schemaForSections(schema, numbers) {
  const { header, sections } = splitSections(schema);
  const wanted = new Set(numbers);
  return [header, ...sections.filter((s) => wanted.has(s.number)).map((s) => s.body)].join('\n');
}

/** Section numbers that already have a migration directory (`<stamp>_<nnnn>_<name>`). */
export function migratedSectionNumbers(migrationDirs) {
  return migrationDirs.map((d) => d.match(/^\d+_(\d{4})_/)?.[1]).filter(Boolean);
}

/** Returns Map<table, Set<column>> of ascii columns, and Map<table, Set<column>> of all columns. */
export function columnMeta(schema) {
  const ascii = new Map();
  const all = new Map();
  const modelRe = /model (\w+) \{([\s\S]*?)\n\}/g;
  let m;
  while ((m = modelRe.exec(schema)) !== null) {
    const body = m[2];
    const mapMatch = body.match(/@@map\("([a-z_]+)"\)/);
    const table = mapMatch ? mapMatch[1] : m[1];
    const asciiCols = new Set();
    const cols = new Set();
    const lines = body.split('\n');
    let pendingAscii = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (line === '/// @ascii') {
        pendingAscii = true;
        continue;
      }
      const field = line.match(/^(\w+)\s+\w+[?[\]]*\s*(.*)$/);
      if (!field || line.startsWith('@@') || line.startsWith('//')) {
        pendingAscii = false;
        continue;
      }
      const colMap = line.match(/@map\("([a-z0-9_]+)"\)/);
      const column = colMap ? colMap[1] : field[1];
      cols.add(column);
      if (pendingAscii) asciiCols.add(column);
      pendingAscii = false;
    }
    ascii.set(table, asciiCols);
    all.set(table, cols);
  }
  return { ascii, all };
}
