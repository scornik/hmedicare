import { type DynamicModule, Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ServerConfig } from '@hmedic/config';
import type { Database } from '@hmedic/database';
import {
  IdentityWriteModule,
  type IdentityServices,
  createIdentityServices,
} from '@hmedic/identity-access/nest';
import { AuthController, SessionController } from './identity/auth.controller';
import { DevInboxController } from './identity/dev-inbox.controller';
import { MeController } from './identity/me.controller';
import { CoverageController, MembershipController } from './tenant-org/tenant-org.controllers';
import { PlatformTenantController } from './tenant-org/platform-tenants.controller';
import { CoverageService, MembershipService, TenantBootstrapService } from '@hmedic/tenant-org';
import { TenantOrgWriteModule, type TenantOrgServices } from '@hmedic/tenant-org/nest';
import {
  HttpKitModule,
  type HttpRuntime,
  type JobComposition,
  composeJobs,
  createHttpApp,
  createRuntime,
} from '@hmedic/http-kit';

/**
 * API composition root (REPOSITORY-STRUCTURE §2.3): wires configuration, the shared HTTP layer and the
 * context modules. Identity/tenant modules are added by ID-001…ID-007.
 */
@Module({})
export class ApiModule {
  static forRoot(
    runtime: HttpRuntime,
    identity: IdentityServices,
    tenantOrg: TenantOrgServices,
  ): DynamicModule {
    const mode = runtime.config.JOB_RUNNER_MODE;
    const devInbox = identity.mockOtp !== null || identity.mockReset !== null;
    return {
      module: ApiModule,
      imports: [
        HttpKitModule.forRoot(runtime, { jobsEndpoint: mode === 'embedded' || mode === 'cron' }),
        IdentityWriteModule.forRoot(identity),
        TenantOrgWriteModule.forRoot(tenantOrg),
      ],
      controllers: [
        AuthController,
        SessionController,
        MeController,
        MembershipController,
        CoverageController,
        PlatformTenantController,
        ...(devInbox ? [DevInboxController] : []),
      ],
    };
  }
}

export interface ApiInstance {
  app: NestFastifyApplication;
  runtime: HttpRuntime;
  identity: IdentityServices;
  jobs: JobComposition | null;
  close(): Promise<void>;
}

/** Builds the API. `JOB_RUNNER_MODE=embedded` also runs the job loop in this process (ADR-015 §7). */
export async function buildApi(
  config: ServerConfig,
  overrides: { database?: Database } = {},
): Promise<ApiInstance> {
  // In `worker` mode the worker app owns the loop; the api only enqueues.
  const { runtime, database } = createRuntime('api', config, overrides);
  const jobs =
    config.JOB_RUNNER_MODE === 'embedded' || config.JOB_RUNNER_MODE === 'cron' ? composeJobs(runtime) : null;
  runtime.runnerLoop = jobs?.loop ?? null;
  const identity = createIdentityServices(runtime);
  const tenantOrg: TenantOrgServices = {
    memberships: new MembershipService(runtime.prisma, runtime.audit, runtime.clock),
    coverages: new CoverageService(runtime.prisma, runtime.audit, config.COVERAGE_MAX_DAYS, runtime.clock),
    bootstrap: new TenantBootstrapService(runtime.prisma, runtime.audit, runtime.clock),
  };
  const app = await createHttpApp(ApiModule.forRoot(runtime, identity, tenantOrg), runtime, { cors: true });
  if (config.JOB_RUNNER_MODE === 'embedded') jobs?.loop.start();
  let closed = false;
  return {
    app,
    runtime,
    identity,
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
