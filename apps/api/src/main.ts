import 'reflect-metadata';
import { ConfigError, type ServerConfig, loadConfig } from '@hmedic/config';
import { applyBuildInfo, recordAppliedMigrations, runGuardedMigrationsSync } from '@hmedic/http-kit';
import { buildApi } from './compose';

/** Entry point (Hostinger Node app `api.<domain>`): fail fast on configuration, then listen on PORT. */
async function main(): Promise<void> {
  let config: ServerConfig;
  try {
    applyBuildInfo(__dirname);
    config = loadConfig<ServerConfig>('api');
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(78);
    }
    throw error;
  }
  // Fallback only when the build step cannot reach the database or cannot run the migrate command — a host
  // whose build command is a fixed dropdown, for one (DEPLOYMENT §4.3; mirrors the worker). The guard takes
  // the same GET_LOCK, proven exclusive on the plan by HOST-004, so two instances starting together cannot
  // both migrate. A failed or locked migration stops startup and the previous deployment keeps serving.
  if (config.MIGRATE_ON_STARTUP) runGuardedMigrationsSync();

  const api = await buildApi(config);
  await api.app.listen({ port: config.PORT, host: '0.0.0.0' });
  api.runtime.logger.info({ port: config.PORT, jobRunnerMode: config.JOB_RUNNER_MODE }, 'api listening');
  try {
    await recordAppliedMigrations(api.runtime);
  } catch (error) {
    api.runtime.logger.error({ err: error }, 'recording MIGRATION_APPLIED audit rows failed');
  }
  const shutdown = (signal: string) => {
    api.runtime.logger.info({ signal }, 'api shutting down');
    void api.close().finally(() => process.exit(0));
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  process.stderr.write(`api failed to start: ${error instanceof Error ? error.name : 'error'}\n`);
  process.exit(1);
});
