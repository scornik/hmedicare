import { AppError } from '@hmedic/kernel';

/**
 * Lock ranking (QUEUE-CONCURRENCY-DESIGN §1/§6, audit C-46). Every transaction must take row locks in
 * non-decreasing rank order, so two transactions can never wait on each other in opposite orders. The
 * ranking is enforced at runtime by `lockRow`: locking a lower-ranked table after a higher-ranked one in the
 * same transaction throws `LOCK_ORDER_VIOLATION` (an internal error that fails the request, never a retry).
 *
 * Ranks are sparse so a context can add tables between existing ones. Tables in the same group may be
 * locked in any order among themselves, provided the rows are locked in ascending id order (`lockRows`).
 */
export const LOCK_RANKING: Readonly<Record<string, number>> = {
  // 10 – tenancy and identity
  tenants: 10,
  users: 10,
  tenant_memberships: 12,
  clinics: 14,
  doctor_profiles: 14,
  staff_profiles: 14,
  doctor_coverages: 16,
  // 20 – patients
  patients: 20,
  patient_merge_cases: 22,
  patient_accounts: 24,
  patient_guardianships: 24,
  care_team_members: 24,
  patient_contacts: 26,
  patient_identifiers: 26,
  patient_consents: 26,
  // 30 – scheduling and queue (QUEUE §5.1: chamber day → serials → encounters → chain checkpoint)
  chambers: 30,
  doctor_schedule_rules: 32,
  appointment_slots: 34,
  chamber_days: 40,
  appointments: 42,
  serials: 44,
  check_ins: 46,
  encounters: 50,
  // 60 – auth and platform rows
  sessions: 60,
  refresh_tokens: 60,
  otp_challenges: 60,
  password_reset_tokens: 60,
  email_verification_tokens: 60,
  platform_operators: 62,
  provider_credentials: 64,
  // 70 – infrastructure rows locked last
  idempotency_records: 70,
  jobs: 72,
  outbox_events: 72,
  singleton_locks: 74,
  integrity_chain_checkpoints: 80,
};

export const LOCK_ORDER_STATE = Symbol('hm:lock-order');

interface LockOrderState {
  highestRank: number;
  highestTable: string;
}

/** Records a lock on `table` for the transaction object and throws when the order is violated. */
export function recordLock(tx: object, table: string): void {
  const rank = LOCK_RANKING[table];
  if (rank === undefined) throw new Error(`lock ranking: table ${table} is not ranked`);
  const holder = tx as { [LOCK_ORDER_STATE]?: LockOrderState };
  const state = holder[LOCK_ORDER_STATE];
  if (state && rank < state.highestRank) {
    throw new AppError('INTERNAL_ERROR', 'lock order violation', {
      cause: new Error(
        `LOCK_ORDER_VIOLATION: ${table} (rank ${rank}) after ${state.highestTable} (rank ${state.highestRank})`,
      ),
    });
  }
  if (!state || rank > state.highestRank) {
    Object.defineProperty(holder, LOCK_ORDER_STATE, {
      value: { highestRank: rank, highestTable: table } satisfies LockOrderState,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
}

/** Test/inspection helper. */
export function lockOrderStateOf(tx: object): LockOrderState | undefined {
  return (tx as { [LOCK_ORDER_STATE]?: LockOrderState })[LOCK_ORDER_STATE];
}
