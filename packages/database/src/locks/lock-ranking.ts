import { AppError } from '@hmedic/kernel';

/**
 * Lock ranking (QUEUE-CONCURRENCY-DESIGN §1/§6, audit C-46). Every transaction must take row locks in
 * non-decreasing rank order, so two transactions can never wait on each other in opposite orders. The
 * ranking is enforced at runtime by `lockRow`: locking a lower-ranked table after a higher-ranked one in the
 * same transaction throws `LOCK_ORDER_VIOLATION` (an internal error that fails the request, never a retry).
 * Re-locking a row this transaction already holds is exempt — see `recordLock`.
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

interface LockOrderState {
  highestRank: number;
  highestTable: string;
  /** `table:key` of every row this transaction already holds an X lock on. */
  held: Set<string>;
}

/**
 * Keyed by the transaction client's identity. A WeakMap (not a property) is required: Prisma's interactive
 * transaction client is a Proxy, and defining a property on it writes through to the shared client, which
 * would leak the state of one transaction into every later one.
 */
const states = new WeakMap<object, LockOrderState>();

/**
 * Records a lock on `table` for the transaction object and throws when the order is violated.
 *
 * `key` identifies the row (its id, or `column=value` for a unique-key lock). Re-locking a row this
 * transaction already holds is exempt from the ranking: the X lock is already ours, so the statement
 * cannot wait and cannot add an edge to the wait-for graph. That is what lets a transaction which locked
 * a chamber day up front allocate that day’s serial counter after it has locked the serial. The case the
 * ranking exists to order is a *new* lock on a lower-ranked table, not a second touch of a held row.
 * Callers that cannot name the row omit `key` and stay under the strict check.
 *
 * A row counts as held only once `markHeld` confirms the lock was taken, so a `FOR UPDATE` that matched
 * nothing never buys an exemption for a row another transaction may insert a moment later.
 */
export function recordLock(tx: object, table: string, key?: string): void {
  const rank = LOCK_RANKING[table];
  if (rank === undefined) throw new Error(`lock ranking: table ${table} is not ranked`);
  const state = states.get(tx);
  const heldKey = key === undefined ? undefined : `${table}:${key}`;
  if (state && heldKey !== undefined && state.held.has(heldKey)) return;
  if (state && rank < state.highestRank) {
    throw new AppError('INTERNAL_ERROR', 'lock order violation', {
      cause: new Error(
        `LOCK_ORDER_VIOLATION: ${table} (rank ${rank}) after ${state.highestTable} (rank ${state.highestRank})`,
      ),
    });
  }
  if (!state) {
    states.set(tx, { highestRank: rank, highestTable: table, held: new Set(heldKey ? [heldKey] : []) });
    return;
  }
  if (rank > state.highestRank) {
    state.highestRank = rank;
    state.highestTable = table;
  }
}

/**
 * Marks `table`/`key` as held by this transaction, exempting later locks on that same row from the
 * ranking. Called by the lock helpers only after the `FOR UPDATE` actually matched a row.
 */
export function markHeld(tx: object, table: string, key: string): void {
  states.get(tx)?.held.add(`${table}:${key}`);
}

/** Test/inspection helper: the highest-ranked table locked so far in this transaction. */
export function lockOrderStateOf(tx: object): { highestRank: number; highestTable: string } | undefined {
  const state = states.get(tx);
  return state ? { highestRank: state.highestRank, highestTable: state.highestTable } : undefined;
}
