import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@hmedic/kernel';
import { rawConnection, truncateAll } from '../support/db';

// Tenant isolation at the schema level (DATABASE-IMPLEMENTATION §4.2 composite-tenant-fk.spec):
// every FK between two tables that both have `tenant_id` must include the tenant_id column pair,
// and a child pointing at another tenant's parent must be rejected by the engine (1452).
let conn: Awaited<ReturnType<typeof rawConnection>>;

beforeAll(async () => {
  await truncateAll();
  conn = await rawConnection();
});
afterAll(async () => {
  await conn?.end();
});

describe('composite tenant foreign keys', () => {
  it('every FK between tenant-owned tables includes (tenant_id → tenant_id)', async () => {
    const tenantTables = new Set<string>(
      (
        (await conn.query(
          "SELECT TABLE_NAME AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'tenant_id'",
        )) as Array<{ t: string }>
      ).map((r) => r.t),
    );
    const fks = (await conn.query(
      `SELECT CONSTRAINT_NAME AS name, TABLE_NAME AS child, REFERENCED_TABLE_NAME AS parent,
              COLUMN_NAME AS col, REFERENCED_COLUMN_NAME AS refCol
         FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL`,
    )) as Array<{ name: string; child: string; parent: string; col: string; refCol: string }>;
    const byName = new Map<string, typeof fks>();
    for (const f of fks) byName.set(f.name, [...(byName.get(f.name) ?? []), f]);
    const missing: string[] = [];
    for (const [name, cols] of byName) {
      const { child, parent } = cols[0]!;
      if (parent === 'tenants' || !tenantTables.has(child) || !tenantTables.has(parent)) continue;
      if (!cols.some((c) => c.col === 'tenant_id' && c.refCol === 'tenant_id'))
        missing.push(`${name} (${child} → ${parent})`);
    }
    expect(missing).toEqual([]);
    expect(byName.size).toBeGreaterThan(5);
  });

  it('rejects a child row that references another tenant’s parent (errno 1452)', async () => {
    const now = new Date();
    const [a, b] = [newId(), newId()];
    for (const t of [a, b]) {
      await conn.query(
        "INSERT INTO tenants (id, name, slug, status, practice_type, default_locale, default_timezone, created_at, updated_at, row_version) VALUES (?, 'DEMO', ?, 'ACTIVE', 'GROUP', 'bn-BD', 'Asia/Dhaka', ?, ?, 1)",
        [t, `demo-${t.slice(-8)}`, now, now],
      );
    }
    const userId = newId();
    await conn.query(
      "INSERT INTO users (id, email_normalized, status, token_version, created_at, updated_at, row_version) VALUES (?, ?, 'ACTIVE', 1, ?, ?, 1)",
      [userId, `fk.${userId.slice(-8)}@example.invalid`, now, now],
    );
    const [doctorA, doctorB] = [newId(), newId()];
    for (const [id, t] of [
      [doctorA, a],
      [doctorB, b],
    ] as const) {
      await conn.query(
        "INSERT INTO doctor_profiles (id, tenant_id, user_id, display_name, specialties, status, created_at, updated_at, row_version) VALUES (?, ?, ?, 'Dr', '[]', 'ACTIVE', ?, ?, 1)",
        [id, t, userId, now, now],
      );
    }
    // Tenant A coverage row pointing at tenant B's doctor profile.
    const err = await conn
      .query(
        "INSERT INTO doctor_coverages (id, tenant_id, covered_doctor_profile_id, covering_doctor_profile_id, starts_at, ends_at, reason, status, granted_by_user_id, created_at, updated_at, row_version) VALUES (?, ?, ?, ?, ?, ?, 'x', 'ACTIVE', ?, ?, ?, 1)",
        [newId(), a, doctorA, doctorB, now, new Date(now.getTime() + 3_600_000), userId, now, now],
      )
      .catch((e: { errno?: number }) => e);
    expect((err as { errno?: number }).errno).toBe(1452);
  });
});
