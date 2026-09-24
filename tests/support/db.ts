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

/**
 * Tables with a self-referencing FK: the referencing rows go first, so a plain `DELETE FROM` cannot be used.
 * `patients` additionally has a CHECK that MERGED rows keep their pointer, so the pointer cannot be nulled.
 */
const SELF_REFERENCING: Readonly<Record<string, string>> = {
  serials: 'rescheduled_from_serial_id',
  appointments: 'rescheduled_from_appointment_id',
  patients: 'merged_into_patient_id',
  diagnoses: 'replaces_diagnosis_id',
};

/** Tables owned by Stage 4/5 migrations, in delete-safe order (children first). */
const TABLES = [
  // 0019 medication_catalog. The global catalog tables are not truncated between tests: they hold no
  // tenant data, they are expensive to rebuild, and a suite that wiped them would be testing against an
  // empty catalog by accident. Only the tenant-scoped rows that point into them go.
  'patient_medications',
  'medication_usage_stats',
  // 0008 clinical_observations: children of encounters, so they go before them.
  'symptom_observations',
  'diagnoses',
  // 0007 encounters: children first. `serials.encounter_id` points here, so the serials delete below
  // would fail on the foreign key if these were left behind.
  'encounter_note_versions',
  'encounter_notes',
  'encounter_participants',
  'encounters',
  // 0006 queue, 0005 scheduling (children of chamber_days/chambers/clinics/patients)
  'queue_events',
  'check_ins',
  'serials',
  'appointments',
  'appointment_slots',
  'chamber_days',
  'doctor_schedule_rules',
  'chambers',
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
  // Append-only in the application and hash-chained, like `platform_gate_decisions` beside it — and
  // cleared here for the same reason: the rows reference `users`, and a suite that left them behind made
  // the next file's `DELETE FROM users` fail on the foreign key. That is what happened: the MEDDATA-001
  // schema suite writes attestations, nothing removed them, and the breakage surfaced only once a new
  // test file changed the order files run in. Resetting a database between tests is the one place
  // deleting these is right; no application path can.
  'medication_dataset_gate_attestations',
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
    // `encounters.serial_id` and `serials.encounter_id` point at each other (0007), so neither table can
    // be deleted first. Breaking the back-pointer turns the cycle into an ordinary parent-child delete.
    await conn.query('UPDATE serials SET encounter_id = NULL WHERE encounter_id IS NOT NULL');
    for (const t of TABLES) {
      const column = SELF_REFERENCING[t];
      if (column) await conn.query(`DELETE FROM \`${t}\` WHERE \`${column}\` IS NOT NULL`);
      await conn.query(`DELETE FROM \`${t}\``);
    }
    await conn.query(`DELETE FROM patients WHERE \`${SELF_REFERENCING.patients}\` IS NOT NULL`);
    await conn.query('DELETE FROM patients');
    await conn.query("UPDATE tenants SET owner_doctor_profile_id = NULL, practice_type = 'GROUP'");
    await conn.query('DELETE FROM doctor_profiles');
    await conn.query('DELETE FROM tenants');
    await conn.query('DELETE FROM users');
  } finally {
    await conn.end();
  }
}
