import {
  CommunicationService,
  CommunicationShortLinks,
  TransactionalSmsDelivery,
  type CommunicationProvider,
} from '@hmedic/communication';
import {
  registerDeliveryJobs,
  registerReminderJobs,
  registerTransactionalSmsJobs,
} from '@hmedic/communication/worker';
import {
  AICredentialSecrets,
  AICredentialValidator,
  AIModelCatalogStore,
  AIProviderRegister,
  AIDraftStore,
  AIJobRunner,
  CURRENT_ACK_TEXT_VERSION,
  RetrievalService,
  registerAICatalogJobs,
  registerAIValidationJobs,
  registerRunAIJob,
  aiApprovalChainSource,
  aiPolicyChainSource,
} from '@hmedic/ai';
import { MockAIProvider } from '@hmedic/ai-adapters-mock';
import { GeminiApiAdapter } from '@hmedic/ai-adapters-gemini';
import {
  OPENAI_COMPATIBLE_PROVIDER_CODES,
  OpenAICompatibleAdapter,
} from '@hmedic/ai-adapters-openai-compatible';
import { SecretEnvelope, kekFromBase64 } from '@hmedic/secrets';
import { PatientCommunicationSource } from '@hmedic/patient';
import { FollowUpReminderSource } from '@hmedic/follow-up';
import { MockEmailAdapter, MockWhatsAppAdapter } from '@hmedic/communication-adapters-mock';
import { registerTimelineJobs } from '@hmedic/timeline/worker';
import { timelineChainSource } from '@hmedic/timeline';
import { type DynamicModule, Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ServerConfig } from '@hmedic/config';
import type { Database } from '@hmedic/database';
import {
  HttpKitModule,
  type HttpRuntime,
  type JobComposition,
  composePlatformJobs,
  createSmsDiagnostics,
  createSmsServices,
  createHttpApp,
  createRuntime,
  jobLagCheck,
  sessionModeCheck,
} from '@hmedic/http-kit';
import type { PeriodicJob } from '@hmedic/jobs';
import { composeSchedulingAndQueue, registerQueueJobs } from '@hmedic/queue';
import { RECORD_MEDICATION_USAGE, medicationGateChainSource } from '@hmedic/prescriptions';
import { registerPrescriptionJobs } from '@hmedic/prescriptions/worker';
import { DiskObjectStorage, DiskUploadStorage } from '@hmedic/storage-adapters-disk';
import {
  registerUploadCleanupJobs,
  registerUploadScanJobs,
  UPLOAD_CATEGORY_POLICY,
  UPLOAD_SCAN_CATEGORIES,
} from '@hmedic/laboratory-documents';
import { BaselineContentPolicyScanner } from '@hmedic/storage-adapters-scanner-baseline';

/**
 * Worker composition root (API-IMPLEMENTATION §2): health, metrics and the cron kick only. Context job
 * handlers arrive through `<Context>WorkerModule`s (dependency rule `worker-only-worker-modules`); no
 * write/read API modules are ever imported here. HOST probes live in apps/host-probe; the only diagnostic here
 * is the SMS-002 provider probe (staging, `DIAGNOSTICS_ENABLED`), because it must run from the worker.
 */
@Module({})
export class WorkerModule {
  static forRoot(runtime: HttpRuntime): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        HttpKitModule.forRoot(runtime, {
          jobsEndpoint: true,
          diagnostics: runtime.config.DIAGNOSTICS_ENABLED,
        }),
      ],
    };
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
  if (config.UPLOAD_SCAN_WORKER_ENABLED && !config.STORAGE_DISK_ROOT)
    throw new Error('UPLOAD_SCAN_WORKER_ENABLED requires STORAGE_DISK_ROOT');
  const { runtime, database } = createRuntime('worker', config, overrides);
  const sms = createSmsServices(runtime);
  const reminderSource = new FollowUpReminderSource(runtime.prisma, runtime.clock);
  const shortLinks = config.SHORT_LINK_PEPPER
    ? new CommunicationShortLinks(
        runtime.prisma,
        runtime.audit,
        reminderSource,
        config.SHORT_LINK_PEPPER,
        runtime.clock,
      )
    : null;
  const notificationProviders = new Map<string, CommunicationProvider>([
    ['email', new MockEmailAdapter(config.LOG_HASH_PEPPER)],
    ['whatsapp', new MockWhatsAppAdapter(config.LOG_HASH_PEPPER)],
  ]);
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
  /**
   * The AI periodic schedule, filled in below only where AI encryption is configured.
   *
   * Declared outside the callback because the scheduler is built from its return value, and a
   * deployment with no AI keys must contribute no AI schedule rather than an entry whose job was
   * never registered.
   */
  let aiPeriodic: PeriodicJob[] = [];
  const jobs = composePlatformJobs(
    runtime,
    sms,
    ({ registry, runner, subscriptions, vault }) => {
      // The medication import runs here and only here: it is minutes of streaming and batched writes on
      // its own queue, and the API process should never be the thing holding that work.
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
            reminderLinks: shortLinks
              ? { issuer: shortLinks, webPublicUrl: config.WEB_PUBLIC_URL }
              : undefined,
          },
          new PatientCommunicationSource(),
          reminderSource,
        );
        registerTransactionalSmsJobs(registry, runner, smsDelivery, runtime.prisma, runtime.clock);
        communication.enableTransactionalSms(smsDelivery);
      }
      registerDeliveryJobs(registry, runner, subscriptions, communication);
      // Ordered per prescription: two jobs for one aggregate must not increment the same counters at
      // once.
      subscriptions.subscribe('PrescriptionApproved', {
        handler: RECORD_MEDICATION_USAGE,
        orderedByAggregate: true,
      });
      /**
       * `ValidateAICredential` (AICRED-004).
       *
       * Composed only where AI encryption is configured, the same condition the API uses to decide
       * whether AI routes exist: without the KEK a credential cannot be opened, so a job that could
       * only fail on its first attempt should not be registered at all. The mock adapter is composed
       * outside production only, so production registers no adapter and validation records
       * `PROVIDER_NOT_SERVED` without moving the status until a vendor adapter ships.
       */
      if (
        config.AI_CREDENTIAL_KEK &&
        config.AI_CREDENTIAL_KEK_ID &&
        config.AI_CREDENTIAL_FINGERPRINT_PEPPER
      ) {
        const aiSecrets = new AICredentialSecrets(
          new SecretEnvelope({
            current: kekFromBase64(config.AI_CREDENTIAL_KEK_ID, config.AI_CREDENTIAL_KEK),
            ...(config.AI_CREDENTIAL_KEK_PREVIOUS && config.AI_CREDENTIAL_KEK_PREVIOUS_ID
              ? {
                  previous: kekFromBase64(
                    config.AI_CREDENTIAL_KEK_PREVIOUS_ID,
                    config.AI_CREDENTIAL_KEK_PREVIOUS,
                  ),
                }
              : {}),
          }),
          config.AI_CREDENTIAL_FINGERPRINT_PEPPER,
        );
        // Same rule as the API: the mock outside production only, Gemini where the configuration
        // lists it. Its production gate still blocks activation in production (ADR-017 §7).
        const aiProviders = new AIProviderRegister([
          ...(config.APP_ENV !== 'production' ? [new MockAIProvider()] : []),
          ...(config.AI_ENABLED_PROVIDER_CODES.includes('gemini') ? [new GeminiApiAdapter()] : []),
          // One instance per enabled provider (ADAPT-004): shared protocol, separate terms and base
          // URLs, and the register keys adapters by provider code.
          ...OPENAI_COMPATIBLE_PROVIDER_CODES.filter((code) =>
            config.AI_ENABLED_PROVIDER_CODES.includes(code),
          ).map((providerCode) => new OpenAICompatibleAdapter({ providerCode })),
        ]);
        registerAIValidationJobs(
          registry,
          runner,
          subscriptions,
          new AICredentialValidator({
            prisma: runtime.prisma,
            audit: runtime.audit,
            secrets: aiSecrets,
            providers: aiProviders,
            environment: config.APP_ENV,
            clock: runtime.clock,
          }),
          runtime.logger,
        );
        // RefreshAIModelCatalog (ADAPT-002). Its schedule leaves the callback so the maintenance
        // scheduler can be built from it.
        /**
         * `RunAIJob` (AI-001): the one place a patient's data is sent to a model.
         *
         * Composed in the worker and only here. The API process cannot resolve a clinical write
         * command, and this runner cannot either — it writes a draft, and everything that reaches a
         * chart goes through an approval with a doctor's attestation.
         */
        registerRunAIJob(
          registry,
          runner,
          new AIJobRunner({
            prisma: runtime.prisma,
            audit: runtime.audit,
            secrets: aiSecrets,
            providers: aiProviders,
            retrieval: new RetrievalService({
              prisma: runtime.prisma,
              lookbackDays: config.AI_RETRIEVAL_DEFAULT_LOOKBACK_DAYS,
              maxItems: config.AI_RETRIEVAL_DEFAULT_MAX_ITEMS,
              maxItemsPerSourceType: config.AI_RETRIEVAL_MAX_ITEMS_PER_SOURCE_TYPE,
              maxProjectionLagSeconds: config.AI_RETRIEVAL_MAX_PROJECTION_LAG_SECONDS,
              now: () => runtime.clock.now(),
            }),
            ...(config.STORAGE_DISK_ROOT
              ? { rawOutput: new DiskObjectStorage({ root: config.STORAGE_DISK_ROOT }) }
              : {}),
            environment: config.APP_ENV,
            enabledProviderCodes: config.AI_ENABLED_PROVIDER_CODES,
            currentAckTextVersion: CURRENT_ACK_TEXT_VERSION,
            freeTierProductionGateClosed: config.AI_FREE_TIER_PRODUCTION_GATE_CLOSED,
            transcriptionEnabled: config.AI_TRANSCRIPTION_ENABLED,
            platformManagedEnabled: config.AI_PLATFORM_MANAGED_ENABLED,
            providerTimeoutSeconds: config.AI_PROVIDER_TIMEOUT_SECONDS,
            schemaRetries: config.AI_SCHEMA_RETRY,
            maxOutputBytes: config.AI_MAX_OUTPUT_BYTES,
            rateLimitMaxWaitSeconds: config.AI_RATE_LIMIT_MAX_WAIT_SECONDS,
            maxFallbacksPerJob: config.AI_MAX_FALLBACKS_PER_JOB,
            draftTtlHours: config.AI_DRAFT_TTL_HOURS,
            draftGraceHoursAfterComplete: config.AI_DRAFT_GRACE_HOURS_AFTER_COMPLETE,
            clock: runtime.clock,
            logger: runtime.logger,
          }),
          { providerTimeoutSeconds: config.AI_PROVIDER_TIMEOUT_SECONDS, logger: runtime.logger },
        );
        aiPeriodic = registerAICatalogJobs(registry, runner, {
          prisma: runtime.prisma,
          catalog: new AIModelCatalogStore({ prisma: runtime.prisma, clock: runtime.clock }),
          providers: aiProviders,
          secrets: aiSecrets,
          // `ExpireAIDrafts` runs beside the catalog refresh: a draft outliving its consultation is a
          // set of suggestions about a patient nobody is currently treating.
          drafts: new AIDraftStore({
            prisma: runtime.prisma,
            audit: runtime.audit,
            clock: runtime.clock,
          }),
          logger: runtime.logger,
        });
      }
      registerPrescriptionJobs(registry, runner, {
        prisma: runtime.prisma,
        environment: config.APP_ENV,
        productionAllowed: config.MEDICATION_IMPORT_PRODUCTION_ALLOWED,
        excludeVeterinary: config.MEDICATION_IMPORT_EXCLUDE_VETERINARY,
        staging: {
          root: config.STORAGE_DISK_ROOT,
          prefix: config.MEDICATION_DATASET_STORAGE_PREFIX,
        },
        // Rendering belongs here for the same reason the import does: it is work nobody is waiting on
        // inside a request.
        storage: config.STORAGE_DISK_ROOT
          ? new DiskObjectStorage({ root: config.STORAGE_DISK_ROOT })
          : undefined,
        logger: runtime.logger,
      });
      if (config.UPLOAD_SCAN_WORKER_ENABLED && config.STORAGE_DISK_ROOT) {
        const storage = new DiskObjectStorage({ root: config.STORAGE_DISK_ROOT });
        const limits = Object.fromEntries(
          UPLOAD_SCAN_CATEGORIES.map((category) => [
            category,
            {
              maxBytes: UPLOAD_CATEGORY_POLICY[category].maxBytes,
              allowedTypes: UPLOAD_CATEGORY_POLICY[category].contentTypes,
              maxPdfPages: config.UPLOAD_SCAN_MAX_PDF_PAGES,
              maxImagePixels: config.UPLOAD_SCAN_MAX_IMAGE_PIXELS,
            },
          ]),
        ) as Record<
          (typeof UPLOAD_SCAN_CATEGORIES)[number],
          {
            maxBytes: number;
            allowedTypes: readonly string[];
            maxPdfPages: number;
            maxImagePixels: number;
          }
        >;
        registerUploadScanJobs(registry, runner, {
          prisma: runtime.prisma,
          scanner: new BaselineContentPolicyScanner({ storage, limits }),
          now: () => runtime.clock.now(),
        });
      }
      return [
        ...aiPeriodic,
        ...(config.STORAGE_DISK_ROOT
          ? registerUploadCleanupJobs(registry, runner, {
              prisma: runtime.prisma,
              storage: new DiskUploadStorage({ root: config.STORAGE_DISK_ROOT }),
              now: () => runtime.clock.now(),
            })
          : []),
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
    // http-kit never imports a context, so every context chain is handed down from here. The AI chains
    // belong in this list for the same reason as the others: a policy decision or an approval that
    // nobody verifies is a record that can be edited without anyone noticing.
    [medicationGateChainSource, timelineChainSource, aiPolicyChainSource, aiApprovalChainSource],
  );
  runtime.smsDiagnostics = config.DIAGNOSTICS_ENABLED ? createSmsDiagnostics(runtime, sms) : null;
  runtime.runnerLoop = jobs?.loop ?? null;
  runtime.readinessChecks.push(sessionModeCheck(runtime), jobLagCheck(runtime));
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
