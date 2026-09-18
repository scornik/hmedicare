import { execFileSync } from 'node:child_process';
import {
  listAppliedMigrations,
  lockChainHead,
  migrateGuardedScriptPath,
  withTransaction,
} from '@hmedic/database';
import { SECURITY_ACTIONS, auditCheckpointKey } from '@hmedic/audit';
import type { HttpRuntime } from './runtime';

/**
 * Records one platform-chain `MIGRATION_APPLIED` audit row per applied migration not yet audited
 * (DEPLOYMENT.md §4.1 step 7). Runs on api/worker startup instead of inside migrate-guarded, which keeps
 * `packages/database` free of an audit dependency (Stage 4 deviation). The platform chain head lock
 * serializes concurrent api/worker startups, so each migration is audited once.
 */
export async function recordAppliedMigrations(runtime: HttpRuntime): Promise<number> {
  const applied = await listAppliedMigrations(runtime.prisma);
  if (applied.length === 0) return 0;
  return withTransaction(runtime.prisma, async (tx) => {
    await lockChainHead(tx, auditCheckpointKey('platform'), runtime.clock.now());
    const audited = await tx.auditLog.findMany({
      where: { chainKey: 'platform', action: SECURITY_ACTIONS.MIGRATION_APPLIED },
      select: { resourceId: true },
    });
    const seen = new Set(audited.map((a) => a.resourceId));
    let recorded = 0;
    for (const m of applied) {
      if (seen.has(m.id)) continue;
      await runtime.audit.append(tx, {
        tenantId: null,
        actorUserId: null,
        actorType: 'SYSTEM',
        action: SECURITY_ACTIONS.MIGRATION_APPLIED,
        resourceType: 'migration',
        resourceId: m.id,
        outcome: 'SUCCESS',
        metadata: {
          migration: m.name,
          appVersion: runtime.config.APP_VERSION,
          recordedBy: runtime.app,
          finishedAt: m.finishedAt.toISOString(),
        },
      });
      recorded++;
    }
    return recorded;
  });
}

/**
 * Worker-startup migration fallback (`MIGRATE_ON_STARTUP=true`, worker only, DEPLOYMENT.md §4.3): runs the
 * guarded script synchronously before the app serves traffic. Throws on a non-zero exit (the process must
 * not start on a failed or locked migration).
 */
export function runGuardedMigrationsSync(env: NodeJS.ProcessEnv = process.env): void {
  execFileSync(process.execPath, [migrateGuardedScriptPath()], { env, stdio: 'inherit' });
}
