import {
  CommunicationLinksController,
  COMMUNICATION_SHORT_LINKS,
} from './communication/communication-links.controller';
import { createProviderCredentialVault } from '@hmedic/provider-credentials/worker';
import {
  SmsAccountsController,
  PlatformSmsBalanceController,
  SMS_ACCOUNT_SERVICE,
} from './communication/sms-accounts.controller';
import {
  CommunicationController,
  CommunicationWebhookController,
  COMMUNICATION_SERVICE,
  COMMUNICATION_PROVIDERS,
} from './communication/communication.controller';
import {
  CommunicationShortLinks,
  SmsAccountService,
  CommunicationService,
  TransactionalSmsDelivery,
  type CommunicationProvider,
} from '@hmedic/communication';
import {
  registerDeliveryJobs,
  registerReminderJobs,
  registerTransactionalSmsJobs,
} from '@hmedic/communication/worker';
import { PatientCommunicationSource } from '@hmedic/patient';
import { FollowUpReminderSource } from '@hmedic/follow-up';
import { MockEmailAdapter, MockWhatsAppAdapter } from '@hmedic/communication-adapters-mock';
import { FollowUpController } from './follow-up/follow-up.controller';
import { FollowUpService } from '@hmedic/follow-up';
import { FollowUpModule } from '@hmedic/follow-up/nest';
import { TimelineController } from './timeline/timeline.controller';
import { TimelineReadModule } from '@hmedic/timeline/nest';
import { TimelineReader, timelineSources } from '@hmedic/timeline';
import { registerTimelineJobs } from '@hmedic/timeline/worker';
import { timelineChainSource } from '@hmedic/timeline';
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
import {
  ClinicService,
  CoverageService,
  MembershipService,
  TenantBootstrapService,
} from '@hmedic/tenant-org';
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
import { SchedulingWriteModule, type SchedulingServices } from '@hmedic/scheduling/nest';
import { composeSchedulingAndQueue, registerQueueJobs } from '@hmedic/queue';
import { QueueWriteModule, type QueueServices } from '@hmedic/queue/nest';
import { composeClinical } from '@hmedic/clinical';
import { ClinicalWriteModule, type ClinicalServices } from '@hmedic/clinical/nest';
import {
  MedicationCatalogAdminService,
  MedicationSearchService,
  PrescriptionOutbox,
  PrescriptionService,
  RECORD_MEDICATION_USAGE,
  medicationGateChainSource,
} from '@hmedic/prescriptions';
import {
  PrescriptionWriteModule,
  type PrescriptionServices,
  registerPrescriptionJobs,
} from '@hmedic/prescriptions/nest';
import { JobPort, JobRegistry, OutboxPort } from '@hmedic/jobs';
import {
  AppointmentController,
  ChamberDayController,
  MyAppointmentsController,
} from './scheduling/chamber-day.controllers';
import {
  ChamberController,
  ClinicController,
  ScheduleRuleController,
} from './scheduling/scheduling.controllers';
import { MySerialsController, QueueBoardController, SerialController } from './scheduling/queue.controllers';
import {
  EncounterController,
  PatientEncounterController,
  SerialEncounterController,
} from './clinical/encounter.controllers';
import { DiagnosisController, EncounterNoteController } from './clinical/note.controllers';
import {
  MedicationImportAdminController,
  MedicationSearchController,
} from './prescriptions/medication-catalog.controllers';
import { PrescriptionController } from './prescriptions/prescription.controllers';
import { DocumentController } from './documents/document.controllers';
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
  sessionModeCheck,
} from '@hmedic/http-kit';
import { DiskObjectStorage } from '@hmedic/storage-adapters-disk';
import { DocumentDownloadService, DownloadTokenService } from '@hmedic/laboratory-documents';
import { DocumentModule, type DocumentServices } from '@hmedic/laboratory-documents/nest';

/**
 * Object storage for generated documents, or null when the deployment has no storage root.
 *
 * `STORAGE_DISK_ROOT` is optional, and a deployment without it still prescribes — it just cannot render
 * a PDF. Null rather than a throwing stub, so the render job is never registered in a process that
 * could not finish it.
 */
function createDocumentStorage(config: { STORAGE_DISK_ROOT?: string | undefined }) {
  return config.STORAGE_DISK_ROOT ? new DiskObjectStorage({ root: config.STORAGE_DISK_ROOT }) : undefined;
}

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
    scheduling: SchedulingServices,
    queue: QueueServices,
    clinical: ClinicalServices,
    prescriptions: PrescriptionServices,
    documents: DocumentServices | null,
    communication: CommunicationService,
    smsAccounts: SmsAccountService,
    shortLinks: CommunicationShortLinks | null,
    notificationProviders: ReadonlyMap<string, CommunicationProvider>,
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
        SchedulingWriteModule.forRoot(scheduling),
        QueueWriteModule.forRoot(queue),
        ClinicalWriteModule.forRoot(clinical),
        FollowUpModule.forRoot(
          new FollowUpService(
            runtime.prisma,
            runtime.audit,
            clinical.access,
            scheduling.appointments,
            runtime.clock,
          ),
        ),
        TimelineReadModule.forRoot(
          new TimelineReader(
            runtime.prisma,
            timelineSources(runtime.prisma),
            runtime.config.TIMELINE_PROJECTION_VERSION,
            runtime.config.CSRF_SECRET,
          ),
        ),
        PrescriptionWriteModule.forRoot(prescriptions),
        // Only when this deployment has document storage. Without it the routes are absent rather than
        // present and failing, so a client discovers the capability from the API rather than from a 409.
        ...(documents ? [DocumentModule.forRoot(documents)] : []),
      ],
      providers: [
        { provide: COMMUNICATION_SHORT_LINKS, useValue: shortLinks },
        { provide: SMS_ACCOUNT_SERVICE, useValue: smsAccounts },
        { provide: COMMUNICATION_SERVICE, useValue: communication },
        { provide: COMMUNICATION_PROVIDERS, useValue: notificationProviders },
      ],
      controllers: [
        CommunicationLinksController,
        SmsAccountsController,
        PlatformSmsBalanceController,
        CommunicationController,
        CommunicationWebhookController,
        FollowUpController,
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
        ClinicController,
        ChamberController,
        ScheduleRuleController,
        ChamberDayController,
        AppointmentController,
        MyAppointmentsController,
        QueueBoardController,
        SerialController,
        MySerialsController,
        EncounterController,
        SerialEncounterController,
        PatientEncounterController,
        TimelineController,
        EncounterNoteController,
        DiagnosisController,
        PrescriptionController,
        MedicationImportAdminController,
        MedicationSearchController,
        ...(documents ? [DocumentController] : []),
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
  scheduling: SchedulingServices;
  queue: QueueServices;
  clinical: ClinicalServices;
  prescriptions: PrescriptionServices;
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
  // DEPLOY-003: the deployed server's own sql_mode is not strict (HOST-001), so readiness proves on a
  // real connection that ADR-014's per-connection init ran. From Stage 6 these tables hold clinical text.
  runtime.readinessChecks.push(sessionModeCheck(runtime));
  const sms = createSmsServices(runtime);
  const smsAccounts = new SmsAccountService(
    runtime.prisma,
    createProviderCredentialVault(config, runtime.prisma, runtime.audit, runtime.clock),
    sms.provider,
    runtime.audit,
    config.ZAMANIT_BALANCE_ALERT_BDT,
    runtime.clock,
  );
  const reminderSource = new FollowUpReminderSource(runtime.prisma, runtime.clock);
  const notificationProviders = new Map<string, CommunicationProvider>([
    ['email', new MockEmailAdapter(config.LOG_HASH_PEPPER)],
    ['whatsapp', new MockWhatsAppAdapter(config.LOG_HASH_PEPPER)],
  ]);
  const shortLinks = config.SHORT_LINK_PEPPER
    ? new CommunicationShortLinks(
        runtime.prisma,
        runtime.audit,
        reminderSource,
        config.SHORT_LINK_PEPPER,
        runtime.clock,
      )
    : null;
  const communication = new CommunicationService(
    runtime.prisma,
    runtime.audit,
    new PatientCommunicationSource(),
    reminderSource,
    config.APP_ENV === 'production' ? new Map() : notificationProviders,
    runtime.clock,
  );
  const context = composeSchedulingAndQueue({
    prisma: runtime.prisma,
    audit: runtime.audit,
    clock: runtime.clock,
  });
  const scheduling: SchedulingServices = {
    chambers: context.chambers,
    schedules: context.schedules,
    days: context.days,
    appointments: context.appointments,
  };
  const queue: QueueServices = { serials: context.serials, queue: context.queue };
  // Built after the queue and handed back into it: cancelling a serial mid-consultation has to interrupt
  // the encounter, and the two contexts cannot import each other (MODULE-BOUNDARIES §3).
  const clinical: ClinicalServices = composeClinical({
    prisma: runtime.prisma,
    audit: runtime.audit,
    serials: context.serials,
    clock: runtime.clock,
    metrics: runtime.metrics,
  });
  const catalogStaging = {
    root: config.STORAGE_DISK_ROOT,
    prefix: config.MEDICATION_DATASET_STORAGE_PREFIX,
  };
  const catalogJobDeps = {
    prisma: runtime.prisma,
    environment: config.APP_ENV,
    productionAllowed: config.MEDICATION_IMPORT_PRODUCTION_ALLOWED,
    excludeVeterinary: config.MEDICATION_IMPORT_EXCLUDE_VETERINARY,
    staging: catalogStaging,
    storage: createDocumentStorage(config),
    logger: runtime.logger,
  };
  const jobs =
    config.JOB_RUNNER_MODE === 'embedded' || config.JOB_RUNNER_MODE === 'cron'
      ? composePlatformJobs(
          runtime,
          sms,
          ({ registry, runner, subscriptions, vault }) => {
            // PrescriptionApproved feeds the tenant prescribing boost (EVENT-ARCHITECTURE §4).
            if (config.APP_ENV !== 'production') {
              const smsDelivery = new TransactionalSmsDelivery(
                {
                  prisma: runtime.prisma,
                  audit: runtime.audit,
                  clock: runtime.clock,
                  provider: sms.provider,
                  platform: sms.platform,
                  vault,
                  rateLimiter: runtime.rateLimiter,
                  maxSendsPerMinute: config.ZAMANIT_MAX_SENDS_PER_MINUTE,
                  metrics: runtime.metrics,
                },
                new PatientCommunicationSource(),
                reminderSource,
              );
              registerTransactionalSmsJobs(registry, runner, smsDelivery, runtime.prisma, runtime.clock);
              communication.enableTransactionalSms(smsDelivery);
            }
            registerDeliveryJobs(registry, runner, subscriptions, communication);
            subscriptions.subscribe('PrescriptionApproved', { handler: RECORD_MEDICATION_USAGE });
            registerPrescriptionJobs(registry, runner, catalogJobDeps);
            return [
              ...(config.APP_ENV !== 'production'
                ? registerReminderJobs(registry, runner, communication, reminderSource)
                : []),
              ...registerQueueJobs(registry, runner, context.serials, { logger: runtime.logger }),
              ...registerTimelineJobs(registry, runner, subscriptions, {
                prisma: runtime.prisma,
                version: config.TIMELINE_PROJECTION_VERSION,
                clock: runtime.clock,
                logger: runtime.logger,
              }),
            ];
          },
          // http-kit never imports a context, so the medication gate chain is handed down from here.
          [medicationGateChainSource, timelineChainSource],
        )
      : null;
  runtime.runnerLoop = jobs?.loop ?? null;
  // The API must be able to *enqueue* an import whatever the runner mode, and in `worker` and `off` modes
  // there is no job composition here at all. So it keeps a registry of its own in that case and registers
  // the type with a null runner: that gives payload validation and enqueueing, and leaves this process
  // with no way to execute an import even by accident.
  const enqueueRegistry = jobs?.registry ?? new JobRegistry();
  if (!jobs) registerPrescriptionJobs(enqueueRegistry, null, catalogJobDeps);
  const prescriptions: PrescriptionServices = {
    catalogAdmin: new MedicationCatalogAdminService({
      prisma: runtime.prisma,
      jobs: new JobPort(runtime.prisma, enqueueRegistry, runtime.clock),
      audit: runtime.audit,
      environment: config.APP_ENV,
      staging: catalogStaging,
      clock: runtime.clock,
    }),
    search: new MedicationSearchService(runtime.prisma, runtime.clock),
    prescriptions: new PrescriptionService({
      prisma: runtime.prisma,
      audit: runtime.audit,
      // The same access policy the notes and diagnoses use: a prescription is part of the encounter,
      // so it answers to the encounter's footing rather than a rule of its own.
      access: clinical.access,
      outbox: new PrescriptionOutbox(new OutboxPort(runtime.clock), runtime.clock),
      clock: runtime.clock,
      metrics: runtime.metrics,
    }),
  };
  const documentStorage = createDocumentStorage(config);
  const documents: DocumentServices | null = documentStorage
    ? {
        downloads: new DocumentDownloadService({
          prisma: runtime.prisma,
          storage: documentStorage,
          tokens: new DownloadTokenService({
            prisma: runtime.prisma,
            rateLimiter: runtime.rateLimiter,
            secret: config.DOWNLOAD_TOKEN_SECRET,
            ttlSeconds: config.DOWNLOAD_TOKEN_TTL_SECONDS,
            clock: runtime.clock,
          }),
        }),
      }
    : null;
  const identity = createIdentityServices(runtime, sms.otpDelivery ? { otpDelivery: sms.otpDelivery } : {});
  const tenantOrg: TenantOrgServices = {
    clinics: new ClinicService(runtime.prisma, runtime.audit, runtime.clock),
    memberships: new MembershipService(runtime.prisma, runtime.audit, runtime.clock),
    coverages: new CoverageService(runtime.prisma, runtime.audit, config.COVERAGE_MAX_DAYS, runtime.clock),
    bootstrap: new TenantBootstrapService(runtime.prisma, runtime.audit, runtime.clock),
  };
  const patient = createPatientServices(runtime);
  identity.patientContexts = patient.contexts;
  identity.onOtpVerified = async (userId, phoneE164) => {
    await patient.access.autoLinkOnOtpVerify(userId, phoneE164);
  };
  const app = await createHttpApp(
    ApiModule.forRoot(
      runtime,
      identity,
      tenantOrg,
      patient,
      scheduling,
      queue,
      clinical,
      prescriptions,
      documents,
      communication,
      smsAccounts,
      shortLinks,
      notificationProviders,
    ),
    runtime,
    { cors: true },
  );
  if (config.JOB_RUNNER_MODE === 'embedded') jobs?.loop.start();
  let closed = false;
  return {
    app,
    runtime,
    identity,
    patient,
    scheduling,
    queue,
    clinical,
    prescriptions,
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
