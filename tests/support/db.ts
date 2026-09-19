import * as mariadb from 'mariadb';
import { inject } from 'vitest';
import { type Database, createDatabase, parseDatabaseUrl } from '@hmedic/database';

/** Shared helpers for integration and security tests (never used by application code). */
export function testDatabaseUrl(): string {
  return inject('databaseUrl');
}

export function openTestDatabase(
  overrides: { poolMax?: number; lockWaitTimeoutSeconds?: number } = {},
): Database {
  return createDatabase({ url: testDatabaseUrl(), poolMax: overrides.poolMax ?? 8, ...overrides });
}

/** A raw connection for tests that need session-level control (locks, EXPLAIN, information_schema). */
export async function rawConnection(root = false): Promise<mariadb.Connection> {
  const url = root ? inject('rootDatabaseUrl') : testDatabaseUrl();
  return mariadb.createConnection({ ...parseDatabaseUrl(url), timezone: '+00:00' });
}

/** Tables owned by Stage 4/5 migrations, in delete-safe order (children first). */
const TABLES = [
  // 0004 patient_identity (children of patients/users/tenants)
  'patient_search_tokens',
  'patient_contacts',
  'patient_identifiers',
  'patient_consents',
  'patient_merge_cases',
  'patient_accounts',
  'patient_guardianships',
  'care_team_members',
  'sms_balance_snapshots',
  'provider_credentials',
  'platform_gate_decisions',
  'platform_operators',
  'integrity_chain_checkpoints',
  'push_devices',
  'email_verification_tokens',
  'password_reset_tokens',
  'otp_challenges',
  'refresh_tokens',
  'sessions',
  'idempotency_records',
  'outbox_events',
  'audit_logs',
  'doctor_coverages',
  'staff_profiles',
  'tenant_memberships',
  'clinics',
  'rate_limit_counters',
  'job_concurrency_leases',
  'dead_letters',
  'jobs',
  'singleton_locks',
];

/** Empties every Stage 4 table. Tenants/doctor profiles need the owner FK cleared first. */
export async function truncateAll(): Promise<void> {
  const conn = await rawConnection();
  try {
    for (const t of TABLES) await conn.query(`DELETE FROM \`${t}\``);
    // patients has a self-referencing composite FK (merged_into_patient_id) and a CHECK that MERGED rows keep
    // their pointer: delete the merged sources first, then everything else.
    await conn.query('DELETE FROM patients WHERE merged_into_patient_id IS NOT NULL');
    await conn.query('DELETE FROM patients');
    await conn.query("UPDATE tenants SET owner_doctor_profile_id = NULL, practice_type = 'GROUP'");
    await conn.query('DELETE FROM doctor_profiles');
    await conn.query('DELETE FROM tenants');
    await conn.query('DELETE FROM users');
  } finally {
    await conn.end();
  }
}
