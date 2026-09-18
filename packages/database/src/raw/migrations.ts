import path from 'node:path';
import type { PrismaClient } from '../client';
import { dbErrorInfo } from '../errors';

export interface AppliedMigration {
  id: string;
  name: string;
  finishedAt: Date;
}

/** Applied migrations from Prisma's bookkeeping table (empty before the first deploy). */
export async function listAppliedMigrations(prisma: PrismaClient): Promise<AppliedMigration[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; name: string; finished_at: Date }>>(
      'SELECT id, migration_name AS name, finished_at FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name',
    );
    return rows.map((r) => ({ id: r.id, name: r.name, finishedAt: new Date(r.finished_at) }));
  } catch (error) {
    if (dbErrorInfo(error).errno === 1146) return [];
    throw error;
  }
}

/**
 * Absolute path of the guarded migration script (DEPLOYMENT.md §4.1) for the worker-startup fallback
 * (`MIGRATE_ON_STARTUP`). Same depth from `src/raw` and `dist/raw`.
 */
export function migrateGuardedScriptPath(): string {
  return path.resolve(__dirname, '..', '..', 'scripts', 'migrate-guarded.mjs');
}
