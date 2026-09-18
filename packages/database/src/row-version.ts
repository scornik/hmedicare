import { AppError, type ErrorCode } from '@hmedic/kernel';

/**
 * Optimistic locking (DATABASE-IMPLEMENTATION.md §1.2): every update of a std table is
 * `UPDATE … SET …, row_version = row_version + 1 WHERE id = ? AND tenant_id = ? AND row_version = ?`.
 * Zero affected rows means the client's `expectedRowVersion` is stale.
 */
export function assertRowVersionMatched(affectedRows: number, code: ErrorCode = 'STALE_VERSION'): void {
  if (affectedRows !== 1) throw new AppError(code);
}

/** Prisma `updateMany` data fragment that bumps the version. */
export const bumpRowVersion = { rowVersion: { increment: 1 } } as const;
