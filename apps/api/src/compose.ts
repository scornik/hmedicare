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
  ConsentService,
  MergeRepointerRegistry,
  MergeService,
  PatientAccessService,
  PatientContextResolver,
  PatientEvents,
  PatientService,
} from '@hmedic/patient';
import { PatientWriteModule, type PatientServices } from '@hmedic/patient/nest';
import { OutboxPort } from '@hmedic/jobs';
import { ConsentController, MergeCaseController, PatientController } from './patient/patient.controllers';
import {
  CareTeamController,
  GuardianshipController,
  PatientAccountController,
} from './patient/patient-access.controllers';
import {
  HttpKitModule,
  type HttpRuntime,
  type JobComposition,
  composePlatformJobs,
  createSmsServices,
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
    patient: PatientServices,
  ): DynamicModule {
    const mode = runtime.config.JOB_RUNNER_MODE;
    const devInbox = identity.mockOtp !== null || identity.mockReset !== null;
    return {
      module: ApiModule,
      imports: [
        HttpKitModule.forRoot(runtime, { jobsEndpoint: mode === 'embedded' || mode === 'cron' }),
        IdentityWriteModule.forRoot(identity),
        TenantOrgWriteModule.forRoot(tenantOrg),
        PatientWriteModule.forRoot(patient),
      ],
      controllers: [
        AuthController,
        SessionController,
        MeController,
        MembershipController,
        CoverageController,
        PlatformTenantController,
        PatientController,
        ConsentController,
        MergeCaseController,
        PatientAccountController,
        GuardianshipController,
        CareTeamController,
        ...(devInbox ? [DevInboxController] : []),
      ],
    };
  }
}

/** Patient context services (Stage 5, CP3). The merge repointer registry is filled by scheduling/queue. */
export function createPatientServices(
  runtime: HttpRuntime,
  repointers = new MergeRepointerRegistry(),
): PatientServices {
  const events = new PatientEvents(new OutboxPort(runtime.clock), runtime.clock);
  return {
    patients: new PatientService(runtime.prisma, runtime.audit, events, runtime.clock),
    merges: new MergeService(runtime.prisma, runtime.audit, events, repointers, runtime.clock),
    consents: new ConsentService(runtime.prisma, runtime.audit, events, runtime.clock),
    access: new PatientAccessService(runtime.prisma, runtime.audit, events, runtime.clock),
    contexts: new PatientContextResolver(runtime.prisma),
  };
}

export interface ApiInstance {
  app: NestFastifyApplication;
  runtime: HttpRuntime;
  identity: IdentityServices;
  patient: PatientServices;
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
  const sms = createSmsServices(runtime);
  const jobs =
    config.JOB_RUNNER_MODE === 'embedded' || config.JOB_RUNNER_MODE === 'cron'
      ? composePlatformJobs(runtime, sms)
      : null;
  runtime.runnerLoop = jobs?.loop ?? null;
  const identity = createIdentityServices(runtime, sms.otpDelivery ? { otpDelivery: sms.otpDelivery } : {});
  const tenantOrg: TenantOrgServices = {
    memberships: new MembershipService(runtime.prisma, runtime.audit, runtime.clock),
    coverages: new CoverageService(runtime.prisma, runtime.audit, config.COVERAGE_MAX_DAYS, runtime.clock),
    bootstrap: new TenantBootstrapService(runtime.prisma, runtime.audit, runtime.clock),
  };
  const patient = createPatientServices(runtime);
  identity.patientContexts = patient.contexts;
  identity.onOtpVerified = async (userId, phoneE164) => {
    await patient.access.autoLinkOnOtpVerify(userId, phoneE164);
  };
  const app = await createHttpApp(ApiModule.forRoot(runtime, identity, tenantOrg, patient), runtime, {
    cors: true,
  });
  if (config.JOB_RUNNER_MODE === 'embedded') jobs?.loop.start();
  let closed = false;
  return {
    app,
    runtime,
    identity,
    patient,
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
