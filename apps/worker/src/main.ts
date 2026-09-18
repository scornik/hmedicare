import 'reflect-metadata';
import { ConfigError, type ServerConfig, loadConfig } from '@hmedic/config';
import { applyBuildInfo, recordAppliedMigrations, runGuardedMigrationsSync } from '@hmedic/http-kit';
import { buildWorker } from './compose';

/** Entry point (Hostinger Node app `worker.<domain>`). */
async function main(): Promise<void> {
  let config: ServerConfig;
  try {
    applyBuildInfo(__dirname);
    config = loadConfig<ServerConfig>('worker');
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(78);
    }
    throw error;
  }
  // Fallback only when the build step cannot reach the DB (HOST-008, DEPLOYMENT §4.3). A failed or locked
  // migration stops startup: the previous deployment keeps serving.
  if (config.MIGRATE_ON_STARTUP) runGuardedMigrationsSync();

  const worker = await buildWorker(config);
  await worker.app.listen({ port: config.PORT, host: '0.0.0.0' });
  worker.runtime.logger.info(
    { port: config.PORT, jobRunnerMode: config.JOB_RUNNER_MODE },
    'worker listening',
  );
  try {
    const recorded = await recordAppliedMigrations(worker.runtime);
    if (recorded) worker.runtime.logger.info({ recorded }, 'migration audit rows recorded');
  } catch (error) {
    worker.runtime.logger.error({ err: error }, 'recording MIGRATION_APPLIED audit rows failed');
  }
  const shutdown = (signal: string) => {
    worker.runtime.logger.info({ signal }, 'worker shutting down');
    void worker.close().finally(() => process.exit(0));
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  process.stderr.write(`worker failed to start: ${error instanceof Error ? error.name : 'error'}\n`);
  process.exit(1);
});
