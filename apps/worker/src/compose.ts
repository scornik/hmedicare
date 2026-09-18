import { type DynamicModule, Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ServerConfig } from '@hmedic/config';
import type { Database } from '@hmedic/database';
import {
  HttpKitModule,
  type HttpRuntime,
  type JobComposition,
  composeJobs,
  createHttpApp,
  createRuntime,
  jobLagCheck,
} from '@hmedic/http-kit';

/**
 * Worker composition root (API-IMPLEMENTATION §2): health, metrics and the cron kick only. Context job
 * handlers arrive through `<Context>WorkerModule`s (dependency rule `worker-only-worker-modules`); no
 * write/read API modules are ever imported here. Diagnostics for HOST tasks live in apps/host-probe.
 */
@Module({})
export class WorkerModule {
  static forRoot(runtime: HttpRuntime): DynamicModule {
    return { module: WorkerModule, imports: [HttpKitModule.forRoot(runtime, { jobsEndpoint: true })] };
  }
}

export interface WorkerInstance {
  app: NestFastifyApplication;
  runtime: HttpRuntime;
  jobs: JobComposition | null;
  close(): Promise<void>;
}

/**
 * `JOB_RUNNER_MODE=worker`: the continuous loop runs here and the hPanel cron kick only keeps the process
 * warm (`skipped: runner_active`). `cron`: no loop; every kick processes one bounded batch. `off`: the kick
 * answers 202 `runner_disabled`.
 */
export async function buildWorker(
  config: ServerConfig,
  overrides: { database?: Database } = {},
): Promise<WorkerInstance> {
  const { runtime, database } = createRuntime('worker', config, overrides);
  const jobs = composeJobs(runtime);
  runtime.runnerLoop = jobs?.loop ?? null;
  runtime.readinessChecks.push(jobLagCheck(runtime));
  const app = await createHttpApp(WorkerModule.forRoot(runtime), runtime, { cors: false });
  if (config.JOB_RUNNER_MODE === 'worker') jobs?.loop.start();
  let closed = false;
  return {
    app,
    runtime,
    jobs,
    async close() {
      if (closed) return;
      closed = true;
      await jobs?.loop.stop();
      await app.close();
      if (!overrides.database) await database.close();
    },
  };
}
