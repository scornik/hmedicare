import { jobLagByQueue, readSessionMode } from '@hmedic/database';
import {
  JobRegistry,
  JobRunner,
  MaintenanceScheduler,
  OutboxPublisher,
  type PeriodicJob,
  RunnerLoop,
  SubscriptionRegistry,
  registerMaintenance,
} from '@hmedic/jobs';
import { VerifyAppendOnlyChains, auditChainSource, registerChainVerification } from '@hmedic/audit';
import { gateChainSource } from '@hmedic/secrets';
import type { HttpRuntime, ReadinessCheck } from './runtime';

export interface JobComposition {
  registry: JobRegistry;
  subscriptions: SubscriptionRegistry;
  runner: JobRunner;
  loop: RunnerLoop;
}

/** Job lag above this marks readiness `degraded` (OBSERVABILITY §5 alert threshold is higher). */
export const JOB_LAG_DEGRADED_SECONDS = 300;

/**
 * Wires the platform job types (maintenance TTL cleanup, chain verification) and the runner loop for the
 * configured mode (ADR-015 §7). Contexts register their own job types/handlers through `extend` before the
 * loop starts. Returns null when `JOB_RUNNER_MODE=off`.
 */
export function composeJobs(
  runtime: HttpRuntime,
  extend: (c: Omit<JobComposition, 'loop'>) => PeriodicJob[] = () => [],
): JobComposition | null {
  const { config, prisma, clock, logger, metrics } = runtime;
  const mode = config.JOB_RUNNER_MODE;
  if (mode === 'off') return null;
  const registry = new JobRegistry();
  const subscriptions = new SubscriptionRegistry();
  const runner = new JobRunner(prisma, registry, {
    strategy: config.JOB_CLAIM_STRATEGY,
    app: runtime.app,
    clock,
    logger,
    metrics,
  });
  const retention = {
    jobRetentionSucceededDays: config.JOB_RETENTION_SUCCEEDED_DAYS,
    jobRetentionFailedDays: config.JOB_RETENTION_FAILED_DAYS,
    outboxRetentionDays: config.OUTBOX_RETENTION_DAYS,
  };
  const periodic: PeriodicJob[] = [
    ...registerMaintenance(registry, runner, prisma, retention, { clock, logger }),
    ...registerChainVerification(
      registry,
      runner,
      new VerifyAppendOnlyChains(prisma, [auditChainSource, gateChainSource], { clock, logger, metrics }),
    ),
    ...extend({ registry, subscriptions, runner }),
  ];
  const publisher = new OutboxPublisher(prisma, registry, subscriptions, {
    strategy: config.JOB_CLAIM_STRATEGY,
    clock,
    metrics,
  });
  const loop = new RunnerLoop(
    prisma,
    runner,
    publisher,
    new MaintenanceScheduler(prisma, periodic, registry),
    {
      databaseUrl: config.DATABASE_URL,
      env: config.APP_ENV,
      maxConcurrency: config.JOB_RUNNER_MAX_CONCURRENCY,
      pollIntervalMs: config.JOB_POLL_INTERVAL_MS,
      pollMaxIntervalMs: config.JOB_POLL_MAX_INTERVAL_MS,
      mode,
      clock,
      logger,
      metrics,
    },
  );
  return { registry, subscriptions, runner, loop };
}

/**
 * Readiness check: this connection is in the session mode ADR-014 requires (Stage 6 DEPLOY-003).
 *
 * `fail`, not `degraded`, and therefore a 503: the deployed server's own `sql_mode` is not strict
 * (HOST-001), so a connection that missed the init would accept silently truncated clinical text.
 * Serving reads from such a process is worse than serving nothing.
 */
export function sessionModeCheck(runtime: HttpRuntime): ReadinessCheck {
  return {
    name: 'sessionMode',
    async run() {
      const report = await readSessionMode(runtime.prisma);
      if (!report.ok) {
        runtime.logger.error(
          { missing: report.missing },
          'connection is not in the session mode ADR-014 requires',
        );
      }
      return { ok: report.ok };
    },
  };
}

/** Readiness check: job lag per queue (worker), also exported as `job_lag_seconds`. */
export function jobLagCheck(runtime: HttpRuntime): ReadinessCheck {
  return {
    name: 'jobs',
    async run() {
      const lag = await jobLagByQueue(runtime.prisma, runtime.clock.now());
      let worst = 0;
      for (const [queue, seconds] of Object.entries(lag)) {
        runtime.metrics.jobLag.set({ queue }, seconds);
        worst = Math.max(worst, seconds);
      }
      return { ok: true, degraded: worst > JOB_LAG_DEGRADED_SECONDS };
    },
  };
}
