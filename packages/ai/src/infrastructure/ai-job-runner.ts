import { createHash } from 'node:crypto';
import { type Clock, newId, systemClock } from '@hmedic/kernel';
import { type Prisma, type PrismaClient, lockRow, withTransaction } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import { OutboxPort } from '@hmedic/jobs';
import type { Logger } from '@hmedic/observability';
import {
  type AIPolicyDecision,
  type DeclaredTier,
  type PolicyCredential,
  evaluateAIPolicy,
} from '../application/policy/effective-policy';
import type { AICredentialSecrets } from '../application/credentials/credential-secrets';
import { PhiMinimizationService } from '../application/minimization/phi-minimization';
import { TokenMap } from '../application/minimization/tokens';
import type { AIErrorClass } from '../application/providers/ai-provider-port';
import type { AIProviderRegister } from '../application/providers/provider-register';
import {
  type PromptPurpose,
  type PromptTemplate,
  loadPromptTemplate,
} from '../application/prompts/template-registry';
import type { RetrievalService, RetrievedItem } from './retrieval-service';

/**
 * `RunAIJob` (AI-001, AI-IMPLEMENTATION §6.2).
 *
 * The one place a patient's data is sent to a model. The order of the steps is the safety property,
 * not an implementation detail, so each is a named private method and the sequence reads top to
 * bottom: claim, check, retrieve, minimize, throttle, re-check, call, record, validate, persist.
 *
 * Four things this handler will not do.
 *
 * **It never holds a transaction across the provider call.** A network call under row locks stalls a
 * tenant's writes for as long as a vendor takes to answer.
 *
 * **It re-reads the credential and the cancel flag immediately before the call and again before
 * persisting.** Revocation is immediate (ADR-017 §4), and a result obtained after revocation is
 * discarded rather than written. The same applies to a doctor who cancelled while the model was
 * answering: a draft nobody is waiting for is still a draft containing their patient's data.
 *
 * **It never writes a clinical record.** It writes a draft and suggestions. Everything that reaches a
 * chart goes through `ApproveAISuggestion` with a doctor's attestation, and the worker container
 * cannot resolve a clinical write command at all.
 *
 * **It discards any suggestion that cites nothing.** The count is kept on the draft so a thin result
 * is explainable, because a suggestion nobody can trace to the record is a claim a doctor would have
 * to verify from scratch — which is more work than writing it themselves.
 */
export type AIJobOutcome = 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'WAITING_RATE_LIMIT' | 'RETRY' | 'SKIPPED';

export interface AIJobReport {
  outcome: AIJobOutcome;
  errorClass?: string;
  reason?: string;
  draftId?: string;
  /** Set on `WAITING_RATE_LIMIT`: when the provider said it would stop refusing. */
  retryAt?: Date;
  suggestions?: number;
  droppedUnsourced?: number;
}

/** Just enough of the storage port for raw output; composition passes the real adapter. */
export interface AIRawOutputStore {
  put(key: string, body: Buffer, contentType: string): Promise<unknown>;
}

export interface AIJobRunnerDeps {
  prisma: PrismaClient;
  audit: PrismaAuditPort;
  secrets: AICredentialSecrets;
  providers: AIProviderRegister;
  retrieval: RetrievalService;
  minimization?: PhiMinimizationService;
  rawOutput?: AIRawOutputStore;
  environment: 'development' | 'test' | 'staging' | 'production';
  enabledProviderCodes: readonly string[];
  currentAckTextVersion: string;
  freeTierProductionGateClosed?: boolean;
  transcriptionEnabled?: boolean;
  platformManagedEnabled?: boolean;
  providerTimeoutSeconds?: number;
  schemaRetries?: number;
  maxOutputBytes?: number;
  rateLimitMaxWaitSeconds?: number;
  draftTtlHours?: number;
  draftGraceHoursAfterComplete?: number;
  promptsDirectory?: string;
  clock?: Clock;
  logger?: Logger;
}

const PURPOSE_FROM_DB: Record<string, PromptPurpose> = {
  NOTE_DRAFT: 'note-draft',
  HISTORY_SUMMARY: 'history-summary',
};

/** Error classes that describe the credential rather than this request. */
const CREDENTIAL_FAULTS: ReadonlySet<string> = new Set([
  'INVALID_CREDENTIAL',
  'QUOTA_EXHAUSTED',
  'TIER_MISMATCH',
]);

export class AIJobRunner {
  private readonly clock: Clock;
  private readonly outbox: OutboxPort;
  private readonly minimization: PhiMinimizationService;

  constructor(private readonly deps: AIJobRunnerDeps) {
    this.clock = deps.clock ?? systemClock;
    this.outbox = new OutboxPort(this.clock);
    this.minimization = deps.minimization ?? new PhiMinimizationService();
  }

  async run(tenantId: string, aiJobId: string, signal?: AbortSignal): Promise<AIJobReport> {
    const claimed = await this.claim(tenantId, aiJobId);
    if (claimed.outcome !== 'SUCCEEDED') return claimed.report;
    const job = claimed.job;

    const purpose = PURPOSE_FROM_DB[job.purpose];
    if (!purpose) {
      // TRANSCRIPTION is the only other value, and it is disabled in MVP. A job for it should never
      // have been created, so failing it is the honest end rather than a silent success.
      return this.fail(tenantId, aiJobId, 'FEATURE_DISABLED', 'TRANSCRIPTION_DISABLED');
    }

    let template: PromptTemplate;
    try {
      const [, version] = job.promptTemplateVersion.split('/');
      template = loadPromptTemplate(purpose, version ?? 'v1', this.deps.promptsDirectory);
    } catch {
      // The template a finished job names must exist for the draft to be explainable later; a job
      // naming one that does not cannot run.
      return this.fail(tenantId, aiJobId, 'PROVIDER_ERROR', 'TEMPLATE_UNAVAILABLE');
    }

    const checks = await this.preCallChecks(tenantId, job, template);
    if (!checks.ok) return this.fail(tenantId, aiJobId, checks.errorClass, checks.reason);

    const retrieved = await this.deps.retrieval.retrieve({
      tenantId,
      patientId: job.patientId,
      encounterId: job.encounterId,
      ...this.selection(job.sourceSelection),
    });

    const prepared = await this.prepare(tenantId, job, retrieved.items, checks.requireMinimization);
    if (!prepared.ok) {
      return this.fail(tenantId, aiJobId, 'PHI_MINIMIZATION_FAILED', prepared.reason, {
        minimizationReport: prepared.report,
        retrievalEffective: retrieved.effective,
      });
    }

    const throttled = await this.throttle(tenantId, job.credentialId);
    if (throttled) {
      return this.wait(tenantId, aiJobId, throttled, 'RATE_LIMITED', 'CLIENT_SIDE_THROTTLE');
    }

    // Re-read immediately before the call: revocation is immediate, and a doctor may have cancelled
    // while retrieval and minimization were running.
    const live = await this.liveState(tenantId, aiJobId, job.credentialId);
    if (live.cancelled) return this.cancel(tenantId, aiJobId, 'DOCTOR_CANCELLED');
    if (!live.credential) {
      return this.fail(tenantId, aiJobId, 'AI_CREDENTIAL_REVOKED', 'CREDENTIAL_NOT_ACTIVE');
    }

    const provider = this.deps.providers.get(job.providerCode);
    if (!provider) return this.fail(tenantId, aiJobId, 'PROVIDER_ERROR', 'PROVIDER_NOT_SERVED');

    const prompt = this.renderPrompt(template, prepared.sections, prepared.patientAge, job);
    let attempt = 0;
    const retries = this.deps.schemaRetries ?? 1;
    let lastSchemaFailure: string | undefined;

    for (;;) {
      const result = await this.callProvider(provider, live.credential, job, prompt, template, signal);
      await this.recordUsage(tenantId, job, result);

      if (result.outcome === 'ERROR') {
        return this.afterProviderError(tenantId, aiJobId, job, result);
      }

      const bytes = Buffer.byteLength(result.text, 'utf8');
      if (this.deps.maxOutputBytes !== undefined && bytes > this.deps.maxOutputBytes) {
        // A runaway response is not a draft, and parsing it would spend memory on something that
        // cannot be shown anyway.
        return this.fail(tenantId, aiJobId, 'SCHEMA_INVALID', 'OUTPUT_TOO_LARGE');
      }

      const validated = this.validate(result.text, template);
      if (!validated.ok) {
        lastSchemaFailure = validated.reason;
        attempt += 1;
        if (attempt > retries) {
          return this.fail(tenantId, aiJobId, 'SCHEMA_INVALID', lastSchemaFailure);
        }
        // One retry of the same template: models produce malformed JSON occasionally and the same
        // prompt usually succeeds. More than that spends a doctor's quota on a model not complying.
        continue;
      }

      const rawKey = await this.storeRawOutput(tenantId, job, prompt, result.text);
      /*
       * Restored after validation rather than before it, which is the one place this departs from
       * §6.2's step order. Restoring into the raw JSON string would splice a patient's name into text
       * that has not been parsed yet, and a name containing a quote would break the document — so the
       * structure is validated first and the placeholders are replaced inside the fields afterwards.
       * Nothing is persisted in between.
       */
      const restored = this.restoreOutput(validated.value, prepared.tokenMap, prepared.anchorDate);
      return this.persist(tenantId, job, {
        template,
        output: restored.value,
        unresolvedTokens: restored.unresolved,
        retrievalEffective: retrieved.effective,
        minimizationReport: prepared.report,
        rawOutputObjectKey: rawKey,
        refs: prepared.refs,
      });
    }
  }

  /**
   * Moves the job to RUNNING, or reports why it will not run.
   *
   * A job that is already finished is skipped rather than failed: the platform runner can deliver the
   * same job twice, and the second delivery must not overwrite a draft that already exists.
   */
  private async claim(
    tenantId: string,
    aiJobId: string,
  ): Promise<
    | { outcome: 'SUCCEEDED'; job: Awaited<ReturnType<PrismaClient['aiJob']['findFirstOrThrow']>> }
    | { outcome: 'OTHER'; report: AIJobReport }
  > {
    return withTransaction(this.deps.prisma, async (tx) => {
      await lockRow(tx, 'ai_jobs', aiJobId, tenantId);
      const row = await tx.aiJob.findFirst({ where: { tenantId, id: aiJobId } });
      if (!row) {
        return { outcome: 'OTHER', report: { outcome: 'SKIPPED', reason: 'JOB_NOT_FOUND' } } as const;
      }
      if (row.cancelRequestedAt) {
        const now = this.clock.now();
        const cancelled = await tx.aiJob.update({
          where: { id: aiJobId },
          data: {
            status: 'CANCELLED',
            finishedAt: now,
            errorClass: 'CANCELLED',
            errorReason: 'DOCTOR_CANCELLED',
            updatedAt: now,
            rowVersion: { increment: 1 },
          },
        });
        return {
          outcome: 'OTHER',
          report: { outcome: 'CANCELLED', errorClass: cancelled.errorClass ?? undefined },
        } as const;
      }
      if (!['QUEUED', 'WAITING_RATE_LIMIT'].includes(row.status)) {
        return {
          outcome: 'OTHER',
          report: { outcome: 'SKIPPED', reason: `STATUS_${row.status}` },
        } as const;
      }
      const now = this.clock.now();
      const running = await tx.aiJob.findFirstOrThrow({ where: { id: aiJobId } });
      await tx.aiJob.update({
        where: { id: aiJobId },
        data: {
          status: 'RUNNING',
          startedAt: running.startedAt ?? now,
          updatedAt: now,
          rowVersion: { increment: 1 },
        },
      });
      return { outcome: 'SUCCEEDED', job: running } as const;
    });
  }

  /** §6.2 step 2, in one read-only pass. Each failure names the class a doctor's screen shows. */
  private async preCallChecks(
    tenantId: string,
    job: Awaited<ReturnType<PrismaClient['aiJob']['findFirstOrThrow']>>,
    template: PromptTemplate,
  ): Promise<{ ok: true; requireMinimization: boolean } | { ok: false; errorClass: string; reason: string }> {
    const [credential, encounter, policy, model] = await Promise.all([
      this.deps.prisma.aiProviderCredential.findFirst({
        where: { tenantId, id: job.credentialId, status: 'ACTIVE' },
      }),
      this.deps.prisma.encounter.findFirst({ where: { tenantId, id: job.encounterId } }),
      this.deps.prisma.tenantAiPolicy.findFirst({ where: { tenantId } }),
      this.deps.prisma.aiModelCatalogEntry.findFirst({
        where: { providerCode: job.providerCode, modelId: job.modelId, deprecatedAt: null },
      }),
    ]);
    if (!credential)
      return { ok: false, errorClass: 'AI_CREDENTIAL_REVOKED', reason: 'CREDENTIAL_NOT_ACTIVE' };
    if (!encounter) return { ok: false, errorClass: 'POLICY_BLOCKED', reason: 'ENCOUNTER_MISSING' };
    if (encounter.doctorProfileId !== job.doctorProfileId) {
      // Reassigned since the request. The doctor who asked is no longer the one treating the patient.
      return { ok: false, errorClass: 'POLICY_BLOCKED', reason: 'DOCTOR_NOT_ASSIGNED' };
    }
    if (!model) return { ok: false, errorClass: 'MODEL_UNAVAILABLE', reason: 'MODEL_DEPRECATED' };
    const capabilities = Array.isArray(model.capabilities) ? (model.capabilities as string[]) : [];
    for (const required of template.requiredCapabilities) {
      if (!capabilities.includes(required)) {
        // A template needing structured output on a model that cannot produce it would send a request
        // whose answer could not be validated.
        return { ok: false, errorClass: 'MODEL_UNAVAILABLE', reason: 'CAPABILITY_MISSING' };
      }
    }

    const metadata = this.deps.providers.metadata(
      credential.providerCode,
      credential.declaredTier as DeclaredTier,
    );
    const decision = await this.evaluate(tenantId, job, credential, metadata, policy);
    if (!decision.allowed) {
      return { ok: false, errorClass: 'POLICY_BLOCKED', reason: decision.reason };
    }
    return { ok: true, requireMinimization: decision.requireMinimization };
  }

  private async evaluate(
    tenantId: string,
    job: { doctorProfileId: string; patientId: string },
    credential: {
      id: string;
      providerCode: string;
      declaredTier: string;
      billingMode: string;
      dataUseAckId: string | null;
    },
    metadata: ReturnType<AIProviderRegister['metadata']>,
    policy: Awaited<ReturnType<PrismaClient['tenantAiPolicy']['findFirst']>>,
  ): Promise<AIPolicyDecision> {
    const [ack, consent] = await Promise.all([
      credential.dataUseAckId
        ? this.deps.prisma.aiDataUseAcknowledgement.findFirst({
            where: {
              tenantId,
              id: credential.dataUseAckId,
              revokedAt: null,
              termsTextVersion: this.deps.currentAckTextVersion,
            },
          })
        : Promise.resolve(null),
      this.deps.prisma.patientConsent.findFirst({
        where: {
          tenantId,
          patientId: job.patientId,
          purpose: 'ai_assistance',
          status: 'GRANTED',
          policyVersion: { gte: policy?.minAiConsentPolicyVersion ?? 1 },
        },
      }),
    ]);
    return evaluateAIPolicy({
      environment: this.deps.environment,
      tenantId,
      doctorProfileId: job.doctorProfileId,
      tenant: {
        aiEnabled: policy?.aiEnabled ?? false,
        freeTierAiAllowed: policy?.freeTierAiAllowed ?? false,
        minimizationRequiredForNoTraining: policy?.minimizationRequiredForNoTraining ?? true,
        allowedProviderCodes: Array.isArray(policy?.allowedProviderCodes)
          ? (policy.allowedProviderCodes as string[])
          : [],
      },
      enabledProviderCodes: this.deps.enabledProviderCodes,
      credential: {
        id: credential.id,
        tenantId,
        doctorProfileId: job.doctorProfileId,
        providerCode: credential.providerCode,
        declaredTier: credential.declaredTier as DeclaredTier,
        billingMode: credential.billingMode as PolicyCredential['billingMode'],
        status: 'ACTIVE',
      },
      metadata,
      assignedDoctor: true,
      patientConsentCurrent: consent !== null,
      acknowledgementCurrent: ack !== null,
      freeTierProductionGateClosed: this.deps.freeTierProductionGateClosed === true,
      rawMediaFeatureEnabled: this.deps.transcriptionEnabled === true,
      syntheticData: this.deps.environment !== 'production',
      ...(this.deps.platformManagedEnabled !== undefined
        ? { platformManagedEnabled: this.deps.platformManagedEnabled }
        : {}),
    });
  }

  private selection(raw: unknown): {
    draftSections?: readonly ('chief_complaint' | 'history' | 'examination' | 'assessment' | 'plan')[];
    lookbackDays?: number;
    maxItems?: number;
  } {
    const value = (raw ?? {}) as Record<string, unknown>;
    const sections = Array.isArray(value.draftSections)
      ? value.draftSections.filter(
          (section): section is 'chief_complaint' | 'history' | 'examination' | 'assessment' | 'plan' =>
            typeof section === 'string' &&
            ['chief_complaint', 'history', 'examination', 'assessment', 'plan'].includes(section),
        )
      : [];
    return {
      ...(sections.length > 0 ? { draftSections: sections } : {}),
      ...(typeof value.lookbackDays === 'number' ? { lookbackDays: value.lookbackDays } : {}),
      ...(typeof value.maxItems === 'number' ? { maxItems: value.maxItems } : {}),
    };
  }

  /**
   * Minimizes the retrieved items when the policy requires it, and fails closed when it cannot.
   *
   * The identifiers come from the record, not from the retrieved text: the known-value layer is the
   * only one that can replace a name or a phone number with certainty, and it needs the values the
   * chart holds. The tenant dictionary adds the clinic, chamber and clinician names, which are
   * identifying in a small practice even though they are not the patient's.
   *
   * Patient identifier values (NID, birth registration) are encrypted at rest and are deliberately
   * not decrypted here. Minimization would have to hold them in memory to search for them, which is a
   * worse trade than relying on the pattern layer: a 10, 13 or 17-digit run is replaced whatever its
   * source. The honest limit is recorded in AI-IMPLEMENTATION §5.5.
   */
  private async prepare(
    tenantId: string,
    job: { patientId: string; encounterId: string; doctorProfileId: string },
    items: readonly RetrievedItem[],
    requireMinimization: boolean,
  ): Promise<
    | {
        ok: true;
        sections: Array<{ ref: string; sourceType: string; text: string }>;
        patientAge: string | null;
        report: Record<string, unknown> | null;
        tokenMap: TokenMap | null;
        /** ISO date the relative-day tokens were measured from, needed to restore them. */
        anchorDate: string | null;
        refs: Map<string, RetrievedItem>;
      }
    | { ok: false; reason: string; report: Record<string, unknown> | null }
  > {
    const refs = new Map(items.map((item) => [item.ref, item]));
    const byType = new Map(items.map((item) => [item.ref, item.sourceType]));
    if (!requireMinimization) {
      /*
       * `NO_TRAINING_CONTRACTUAL` with the tenant's recorded relaxation (ADR-017 §3). The text goes as
       * authored, and the job records no minimization report rather than an empty one — "none ran" and
       * "none was needed" are different statements and a reviewer needs to tell them apart.
       */
      return {
        ok: true,
        sections: items.map((item) => ({
          ref: item.ref,
          sourceType: item.sourceType,
          text: item.text,
        })),
        patientAge: null,
        report: null,
        tokenMap: null,
        anchorDate: null,
        refs,
      };
    }

    const [patient, contacts, encounter, clinicians, clinics, chambers, tenant] = await Promise.all([
      this.deps.prisma.patient.findFirst({ where: { tenantId, id: job.patientId } }),
      this.deps.prisma.patientContact.findMany({
        where: { tenantId, patientId: job.patientId, status: 'ACTIVE' },
      }),
      this.deps.prisma.encounter.findFirst({ where: { tenantId, id: job.encounterId } }),
      this.deps.prisma.doctorProfile.findMany({ where: { tenantId }, select: { displayName: true } }),
      this.deps.prisma.clinic.findMany({ where: { tenantId }, select: { name: true } }),
      this.deps.prisma.chamber.findMany({ where: { tenantId }, select: { name: true } }),
      this.deps.prisma.tenant.findFirst({ where: { id: tenantId }, select: { name: true } }),
    ]);
    if (!patient || !encounter) {
      // Fail closed: without the patient's own values the known-value layer cannot run, and sending
      // the text with only the pattern layer would be weaker minimization than the policy requires.
      return { ok: false, reason: 'MINIMIZATION_CONTEXT_MISSING', report: null };
    }

    const addressLines = Array.isArray(patient.address)
      ? (patient.address as unknown[]).filter((line): line is string => typeof line === 'string')
      : patient.address && typeof patient.address === 'object'
        ? Object.values(patient.address as Record<string, unknown>).filter(
            (line): line is string => typeof line === 'string',
          )
        : [];

    const anchorDate = (encounter.startedAt ?? encounter.createdAt).toISOString();
    const result = this.minimization.minimize({
      patient: {
        names: [patient.legalName, patient.legalNameBn, patient.displayName].filter(
          (name): name is string => typeof name === 'string' && name.length > 0,
        ),
        contacts: contacts.map((contact) => contact.displayValue),
        ...(patient.dateOfBirth ? { dateOfBirth: patient.dateOfBirth.toISOString() } : {}),
        addressLines,
      },
      tenantDictionary: {
        facilityNames: [
          ...clinics.map((clinic) => clinic.name),
          ...chambers.map((chamber) => chamber.name),
          ...(tenant?.name ? [tenant.name] : []),
        ],
        clinicianNames: clinicians.map((clinician) => clinician.displayName),
      },
      // The consultation's own date: every other date becomes a day offset from it.
      encounterAnchorDate: anchorDate,
      sections: items.map((item) => ({
        key: item.ref,
        contentType: 'text' as const,
        text: item.text,
      })),
      maxInputCharacters: this.deps.maxOutputBytes ?? undefined,
    });
    if (!result.ok) {
      // Nothing is sent. The reason is a rule name, which is what the doctor's screen can show.
      return { ok: false, reason: result.error.reason, report: null };
    }
    return {
      ok: true,
      sections: result.value.sections.map((section) => ({
        ref: section.key,
        sourceType: byType.get(section.key) ?? 'unknown',
        text: section.text,
      })),
      patientAge: result.value.patientAge,
      report: result.value.report as unknown as Record<string, unknown>,
      tokenMap: result.value.tokenMap,
      anchorDate,
      refs,
    };
  }

  /** The client-side throttle (§6.2 step 5): a 429 we can avoid costs the doctor nothing. */
  private async throttle(tenantId: string, credentialId: string): Promise<Date | null> {
    const counter = await this.deps.prisma.aiUsageCounter.findFirst({
      where: { tenantId, credentialId, retryAfterUntil: { gt: this.clock.now() } },
      orderBy: { retryAfterUntil: 'desc' },
    });
    return counter?.retryAfterUntil ?? null;
  }

  private async liveState(tenantId: string, aiJobId: string, credentialId: string) {
    const [job, credential] = await Promise.all([
      this.deps.prisma.aiJob.findFirst({ where: { tenantId, id: aiJobId } }),
      this.deps.prisma.aiProviderCredential.findFirst({
        where: { tenantId, id: credentialId, status: 'ACTIVE' },
      }),
    ]);
    return { cancelled: Boolean(job?.cancelRequestedAt), credential };
  }

  private renderPrompt(
    template: PromptTemplate,
    sections: ReadonlyArray<{ ref: string; sourceType: string; text: string }>,
    patientAge: string | null,
    job: { modelId: string },
  ): string {
    const sources = sections
      .map(
        (section) =>
          // Delimited and attributed, and the template says instructions inside these are to be
          // ignored. This is the prompt-injection boundary.
          `<source id="${section.ref}" type="${section.sourceType}">\n${section.text}\n</source>`,
      )
      .join('\n\n');
    return template.body
      .replace('{{patientAge}}', patientAge ?? 'not available')
      .replace('{{noteLanguage}}', 'as authored')
      .replace('{{requestedSections}}', sections.map((section) => section.sourceType).join(', '))
      .replace('{{lookbackDays}}', 'as configured')
      .replace('{{sources}}', sources)
      .concat(`\n\n<!-- model: ${job.modelId} -->\n`);
  }

  private async callProvider(
    provider: NonNullable<ReturnType<AIProviderRegister['get']>>,
    credential: {
      id: string;
      providerCode: string;
      declaredTier: string;
      encryptedSecret: string;
      wrappedDataKey: string;
      keyId: string;
      doctorProfileId: string;
      tenantId: string;
    },
    job: { modelId: string },
    prompt: string,
    template: PromptTemplate,
    signal?: AbortSignal,
  ): Promise<
    | { outcome: 'OK'; text: string; usage?: { inputTokens?: number; outputTokens?: number } }
    | { outcome: 'ERROR'; errorClass: AIErrorClass; providerCode?: string; retryAfterSeconds?: number }
  > {
    const scope = {
      credentialId: credential.id,
      tenantId: credential.tenantId,
      doctorProfileId: credential.doctorProfileId,
      providerCode: credential.providerCode,
    };
    try {
      const result = await this.deps.secrets.use(scope, credential, async (apiKey) =>
        provider.generate(
          {
            credentialId: credential.id,
            providerCode: credential.providerCode,
            declaredTier: credential.declaredTier as DeclaredTier,
            withKey: (fn) => fn(apiKey),
          },
          {
            modelId: job.modelId,
            prompt,
            jsonSchema: template.jsonSchema,
            ...(signal ? { signal } : {}),
          },
        ),
      );
      if (result.outcome === 'ERROR') {
        return {
          outcome: 'ERROR',
          errorClass: result.errorClass,
          ...(result.providerCode ? { providerCode: result.providerCode } : {}),
          ...(result.retryAfterSeconds !== undefined ? { retryAfterSeconds: result.retryAfterSeconds } : {}),
        };
      }
      return {
        outcome: 'OK',
        text: result.value.text,
        ...(result.usage ? { usage: result.usage } : {}),
      };
    } catch {
      // The secret owner normalizes both an unusable envelope and an adapter that threw. Neither says
      // what the provider did, so neither may be treated as "did not happen".
      return { outcome: 'ERROR', errorClass: 'UNKNOWN_OUTCOME', providerCode: 'CALL_FAILED' };
    }
  }

  /** Counters and the ledger (§6.2 step 8). Written whatever the outcome was. */
  private async recordUsage(
    tenantId: string,
    job: {
      id: string;
      credentialId: string;
      doctorProfileId: string;
      providerCode: string;
      modelId: string;
      billingMode: string;
    },
    result:
      | { outcome: 'OK'; usage?: { inputTokens?: number; outputTokens?: number } }
      | { outcome: 'ERROR'; errorClass: AIErrorClass; retryAfterSeconds?: number },
  ): Promise<void> {
    const now = this.clock.now();
    const input = result.outcome === 'OK' ? (result.usage?.inputTokens ?? 0) : 0;
    const output = result.outcome === 'OK' ? (result.usage?.outputTokens ?? 0) : 0;
    const retryAfterUntil =
      result.outcome === 'ERROR' && result.errorClass === 'RATE_LIMITED'
        ? new Date(now.getTime() + (result.retryAfterSeconds ?? 60) * 1000)
        : null;

    await withTransaction(this.deps.prisma, async (tx) => {
      for (const [window, ms] of [
        ['MINUTE', 60_000],
        ['DAY', 86_400_000],
      ] as const) {
        const windowStart = new Date(Math.floor(now.getTime() / ms) * ms);
        await tx.aiUsageCounter.upsert({
          where: {
            credentialId_window_windowStart: { credentialId: job.credentialId, window, windowStart },
          },
          create: {
            credentialId: job.credentialId,
            tenantId,
            window,
            windowStart,
            requestCount: 1,
            inputTokens: BigInt(input),
            outputTokens: BigInt(output),
            ...(retryAfterUntil ? { last429At: now, retryAfterUntil } : {}),
            updatedAt: now,
          },
          update: {
            requestCount: { increment: 1 },
            inputTokens: { increment: BigInt(input) },
            outputTokens: { increment: BigInt(output) },
            ...(retryAfterUntil ? { last429At: now, retryAfterUntil } : {}),
            updatedAt: now,
          },
        });
      }
      await tx.aiUsageLedgerEntry.create({
        data: {
          id: newId(),
          tenantId,
          jobId: job.id,
          credentialId: job.credentialId,
          doctorProfileId: job.doctorProfileId,
          providerCode: job.providerCode,
          modelId: job.modelId,
          billingMode: job.billingMode,
          inputTokens: input,
          outputTokens: output,
          outcome: result.outcome === 'OK' ? 'SUCCESS' : 'ERROR',
          ...(result.outcome === 'ERROR' ? { errorClass: result.errorClass } : {}),
          occurredAt: now,
        },
      });
    });
  }

  /** §6.2 step 9: the provider's class decides whether the job waits, retries, or stops. */
  private async afterProviderError(
    tenantId: string,
    aiJobId: string,
    job: { credentialId: string },
    result: { errorClass: AIErrorClass; providerCode?: string; retryAfterSeconds?: number },
  ): Promise<AIJobReport> {
    if (result.errorClass === 'RATE_LIMITED') {
      const retryAt = new Date(this.clock.now().getTime() + (result.retryAfterSeconds ?? 60) * 1000);
      const maxWait = (this.deps.rateLimitMaxWaitSeconds ?? 900) * 1000;
      if (retryAt.getTime() - this.clock.now().getTime() > maxWait) {
        // A wait longer than a consultation is not a wait a doctor benefits from. Failing with a
        // reason they can act on beats a job that never finishes.
        return this.fail(tenantId, aiJobId, 'RATE_LIMITED', 'WAIT_TOO_LONG');
      }
      return this.wait(tenantId, aiJobId, retryAt, 'RATE_LIMITED', result.providerCode ?? 'PROVIDER');
    }
    if (CREDENTIAL_FAULTS.has(result.errorClass)) {
      // The credential, not the request. Settling it here is what stops every later job trying the
      // same spent or rejected key.
      await this.settleCredential(tenantId, job.credentialId, result.errorClass);
      return this.fail(tenantId, aiJobId, result.errorClass, result.providerCode ?? 'PROVIDER');
    }
    if (result.errorClass === 'CONTENT_BLOCKED' || result.errorClass === 'MODEL_UNAVAILABLE') {
      // Retrying sends the same text to the same model.
      return this.fail(tenantId, aiJobId, result.errorClass, result.providerCode ?? 'PROVIDER');
    }
    // PROVIDER_ERROR, PROVIDER_UNAVAILABLE, UNKNOWN_OUTCOME, SCHEMA_INVALID from the provider: back to
    // QUEUED so the platform runner's backoff applies.
    await this.requeue(tenantId, aiJobId, result.errorClass, result.providerCode ?? 'PROVIDER');
    return { outcome: 'RETRY', errorClass: result.errorClass };
  }

  private async settleCredential(tenantId: string, credentialId: string, errorClass: string) {
    const status = errorClass === 'QUOTA_EXHAUSTED' ? 'QUOTA_EXHAUSTED' : 'INVALID';
    await withTransaction(this.deps.prisma, async (tx) => {
      await lockRow(tx, 'ai_provider_credentials', credentialId, tenantId);
      const row = await tx.aiProviderCredential.findFirst({ where: { tenantId, id: credentialId } });
      if (!row || !['ACTIVE', 'PENDING_VALIDATION'].includes(row.status)) return;
      const now = this.clock.now();
      await tx.aiProviderCredential.update({
        where: { id: credentialId },
        data: {
          status,
          lastErrorClass: errorClass,
          updatedAt: now,
          rowVersion: { increment: 1 },
        },
      });
      await this.deps.audit.append(tx, {
        tenantId,
        actorUserId: null,
        actorType: 'SYSTEM',
        action: 'AI_CREDENTIAL_SETTLED_BY_JOB',
        resourceType: 'ai_credential',
        resourceId: credentialId,
        outcome: 'FAILED',
        requestId: null,
        metadata: { status, errorClass },
      });
    });
  }

  private validate(
    text: string,
    template: PromptTemplate,
  ): { ok: true; value: unknown } | { ok: false; reason: string } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, reason: 'UNPARSEABLE_JSON' };
    }
    const result = template.outputSchema.safeParse(parsed);
    // Strict: an unknown field is a model inventing structure, and dropping it silently would hide
    // that a draft contains something nobody asked for.
    return result.success ? { ok: true, value: result.data } : { ok: false, reason: 'SCHEMA_MISMATCH' };
  }

  /**
   * Stores the post-minimization request and the raw response (§6.2 step 10).
   *
   * Post-minimization on purpose: this object is kept for audit and support, and storing the
   * pre-minimization prompt would make the retention of identifiers longer than the call that needed
   * them. Skipped entirely when the tenant's retention is zero.
   */
  private async storeRawOutput(
    tenantId: string,
    job: { id: string },
    prompt: string,
    response: string,
  ): Promise<string | null> {
    if (!this.deps.rawOutput) return null;
    const policy = await this.deps.prisma.tenantAiPolicy.findFirst({ where: { tenantId } });
    if ((policy?.rawOutputRetentionDays ?? 0) <= 0) return null;
    const key = `t/${tenantId}/ai-raw/${job.id}/1`;
    try {
      await this.deps.rawOutput.put(
        key,
        Buffer.from(JSON.stringify({ request: prompt, response }), 'utf8'),
        'application/json',
      );
      return key;
    } catch {
      // Storage failing must not fail a draft the doctor can already use. The draft records no key,
      // which is the honest statement that nothing was kept.
      this.deps.logger?.info({ aiJobId: job.id }, 'AI raw output could not be stored');
      return null;
    }
  }

  /** §6.2 step 12, in one transaction, after a last check that nothing has changed underneath. */
  private async persist(
    tenantId: string,
    job: Awaited<ReturnType<PrismaClient['aiJob']['findFirstOrThrow']>>,
    input: {
      template: PromptTemplate;
      output: unknown;
      /** Placeholders the model produced that this service never issued. */
      unresolvedTokens: number;
      retrievalEffective: unknown;
      minimizationReport: Record<string, unknown> | null;
      rawOutputObjectKey: string | null;
      refs: Map<string, RetrievedItem>;
    },
  ): Promise<AIJobReport> {
    const now = this.clock.now();
    const suggestions = this.toSuggestions(input.output, input.refs, input.unresolvedTokens > 0);
    const expiresAt = await this.expiry(tenantId, job.encounterId, now);

    return withTransaction(this.deps.prisma, async (tx) => {
      await lockRow(tx, 'ai_jobs', job.id, tenantId);
      const current = await tx.aiJob.findFirst({ where: { tenantId, id: job.id } });
      if (!current || current.status !== 'RUNNING') {
        return { outcome: 'SKIPPED', reason: `STATUS_${current?.status ?? 'MISSING'}` };
      }
      if (current.cancelRequestedAt) {
        // Cancelled while the model was answering. The result is discarded: a draft nobody waits for
        // still contains their patient's data.
        await tx.aiJob.update({
          where: { id: job.id },
          data: {
            status: 'CANCELLED',
            finishedAt: now,
            errorClass: 'CANCELLED',
            errorReason: 'DOCTOR_CANCELLED',
            updatedAt: now,
            rowVersion: { increment: 1 },
          },
        });
        return { outcome: 'CANCELLED', errorClass: 'CANCELLED' };
      }
      const credential = await tx.aiProviderCredential.findFirst({
        where: { tenantId, id: job.credentialId, status: 'ACTIVE' },
      });
      if (!credential) {
        // Revoked while the model was answering. ADR-017 §4: results obtained after revocation are
        // discarded.
        await tx.aiJob.update({
          where: { id: job.id },
          data: {
            status: 'FAILED',
            finishedAt: now,
            errorClass: 'AI_CREDENTIAL_REVOKED',
            errorReason: 'REVOKED_DURING_CALL',
            updatedAt: now,
            rowVersion: { increment: 1 },
          },
        });
        return { outcome: 'FAILED', errorClass: 'AI_CREDENTIAL_REVOKED' };
      }

      const draftId = newId();
      await tx.aiDraft.create({
        data: {
          id: draftId,
          tenantId,
          aiJobId: job.id,
          encounterId: job.encounterId,
          patientId: job.patientId,
          draftType: job.purpose === 'NOTE_DRAFT' ? 'NOTE_DRAFT' : 'HISTORY_SUMMARY',
          status: 'READY_FOR_REVIEW',
          outputSchemaVersion: input.template.outputSchemaVersion,
          validatedOutput: input.output as object,
          ...(input.rawOutputObjectKey ? { rawOutputObjectKey: input.rawOutputObjectKey } : {}),
          droppedUnsourcedCount: suggestions.dropped,
          expiresAt,
          createdAt: now,
          updatedAt: now,
        },
      });
      for (const suggestion of suggestions.rows) {
        await tx.aiSuggestion.create({
          data: {
            id: newId(),
            tenantId,
            aiDraftId: draftId,
            suggestionType: suggestion.suggestionType,
            ...(suggestion.targetSection ? { targetSection: suggestion.targetSection } : {}),
            sourceRefs: suggestion.sourceRefs as object,
            candidate: suggestion.candidate as object,
            confidence: suggestion.confidence,
            status: 'PENDING',
            createdAt: now,
            updatedAt: now,
          },
        });
      }
      await tx.aiJob.update({
        where: { id: job.id },
        data: {
          status: 'SUCCEEDED',
          finishedAt: now,
          errorClass: null,
          errorReason: null,
          ...(input.minimizationReport
            ? { minimizationReport: input.minimizationReport as Prisma.InputJsonValue }
            : {}),
          retrievalEffective: input.retrievalEffective as Prisma.InputJsonValue,
          updatedAt: now,
          rowVersion: { increment: 1 },
        },
      });
      await this.outbox.append(tx, {
        tenantId,
        eventName: 'AIDraftCreated',
        eventVersion: 1,
        aggregateType: 'ai_draft',
        aggregateId: draftId,
        correlationId: job.correlationId,
        causationId: null,
        actorId: null,
        idempotencyKey: null,
        // Identifiers and counts. A draft's content never enters an event payload.
        payload: {
          aiDraftId: draftId,
          aiJobId: job.id,
          encounterId: job.encounterId,
          suggestions: suggestions.rows.length,
        },
      });
      await this.deps.audit.append(tx, {
        tenantId,
        actorUserId: null,
        actorType: 'SYSTEM',
        action: 'AI_DRAFT_CREATED',
        resourceType: 'ai_draft',
        resourceId: draftId,
        outcome: 'SUCCESS',
        requestId: null,
        metadata: {
          aiJobId: job.id,
          providerCode: job.providerCode,
          modelId: job.modelId,
          suggestions: suggestions.rows.length,
          droppedUnsourced: suggestions.dropped,
        },
      });
      return {
        outcome: 'SUCCEEDED',
        draftId,
        suggestions: suggestions.rows.length,
        droppedUnsourced: suggestions.dropped,
      };
    });
  }

  /**
   * The earlier of the TTL and the grace period after the encounter completes (§7.1).
   *
   * A draft outliving the consultation it was written for is a suggestion about a patient nobody is
   * currently treating.
   */
  private async expiry(tenantId: string, encounterId: string, now: Date): Promise<Date> {
    const ttl = new Date(now.getTime() + (this.deps.draftTtlHours ?? 72) * 3600_000);
    const encounter = await this.deps.prisma.encounter.findFirst({
      where: { tenantId, id: encounterId },
      select: { completedAt: true },
    });
    if (!encounter?.completedAt) return ttl;
    const grace = new Date(
      encounter.completedAt.getTime() + (this.deps.draftGraceHoursAfterComplete ?? 24) * 3600_000,
    );
    return grace < ttl ? grace : ttl;
  }

  /**
   * Turns validated output into suggestion rows, dropping any that cites nothing.
   *
   * A citation must resolve to something actually retrieved. A model citing `s9` when nine sources
   * were never sent has invented the reference, and a suggestion resting on an invented citation is
   * worse than no suggestion: it looks checkable and is not.
   */
  private toSuggestions(
    output: unknown,
    refs: ReadonlyMap<string, RetrievedItem>,
    hadUnresolvedTokens: boolean,
  ): {
    rows: Array<{
      suggestionType: string;
      targetSection?: string;
      sourceRefs: unknown;
      candidate: unknown;
      confidence: string;
    }>;
    dropped: number;
  } {
    const value = (output ?? {}) as { suggestions?: unknown[]; items?: unknown[] };
    const raw = [...(value.suggestions ?? []), ...(value.items ?? [])];
    const rows: Array<{
      suggestionType: string;
      targetSection?: string;
      sourceRefs: unknown;
      candidate: unknown;
      confidence: string;
    }> = [];
    let dropped = 0;
    for (const entry of raw) {
      const candidate = entry as Record<string, unknown>;
      const ids = Array.isArray(candidate.sourceIds)
        ? candidate.sourceIds.filter((id): id is string => typeof id === 'string')
        : [];
      const resolved = ids
        .map((id) => refs.get(id))
        .filter((item): item is RetrievedItem => item !== undefined)
        .map((item) => ({
          sourceType: item.sourceType,
          sourceId: item.sourceId,
          occurredAt: item.occurredAt.toISOString(),
        }));
      if (resolved.length === 0) {
        dropped += 1;
        continue;
      }
      const suggestionType =
        typeof candidate.suggestionType === 'string' ? candidate.suggestionType : 'HISTORY_ITEM';
      rows.push({
        suggestionType,
        ...(typeof candidate.targetSection === 'string' ? { targetSection: candidate.targetSection } : {}),
        sourceRefs: resolved,
        candidate,
        // A draft containing a placeholder nobody issued is low confidence whatever the model claimed
        // (AI-IMPLEMENTATION §5.4): the model referred to something that was never sent.
        confidence: hadUnresolvedTokens
          ? 'LOW'
          : typeof candidate.confidence === 'string' &&
              ['LOW', 'MEDIUM', 'HIGH'].includes(candidate.confidence)
            ? candidate.confidence
            : 'UNKNOWN',
      });
    }
    return { rows, dropped };
  }

  /**
   * Replaces placeholders in every string of the validated output.
   *
   * Relative days become dates again and mapped tokens become their originals. A token the model
   * produced that this service never issued is left visible and counted: the suggestion carrying it is
   * marked low confidence rather than being shown with a plausible invented value, because a doctor
   * can see a placeholder and cannot see a fabrication.
   */
  private restoreOutput(
    output: unknown,
    tokenMap: TokenMap | null,
    anchorDate: string | null,
  ): { value: unknown; unresolved: number } {
    if (!anchorDate) return { value: output, unresolved: 0 };
    const map = tokenMap ?? new TokenMap();
    let unresolved = 0;
    const walk = (node: unknown): unknown => {
      if (typeof node === 'string') {
        const restored = this.minimization.restoreText(node, map, anchorDate);
        unresolved += restored.unresolved.length;
        return restored.text;
      }
      if (Array.isArray(node)) return node.map(walk);
      if (node && typeof node === 'object') {
        return Object.fromEntries(
          Object.entries(node as Record<string, unknown>).map(([key, value]) => [key, walk(value)]),
        );
      }
      return node;
    };
    return { value: walk(output), unresolved };
  }

  private async fail(
    tenantId: string,
    aiJobId: string,
    errorClass: string,
    reason: string,
    extra: { minimizationReport?: Record<string, unknown> | null; retrievalEffective?: unknown } = {},
  ): Promise<AIJobReport> {
    const now = this.clock.now();
    await withTransaction(this.deps.prisma, async (tx) => {
      await lockRow(tx, 'ai_jobs', aiJobId, tenantId);
      await tx.aiJob.update({
        where: { id: aiJobId },
        data: {
          status: 'FAILED',
          finishedAt: now,
          errorClass,
          errorReason: reason,
          ...(extra.minimizationReport
            ? { minimizationReport: extra.minimizationReport as Prisma.InputJsonValue }
            : {}),
          ...(extra.retrievalEffective
            ? { retrievalEffective: extra.retrievalEffective as Prisma.InputJsonValue }
            : {}),
          updatedAt: now,
          rowVersion: { increment: 1 },
        },
      });
      await this.deps.audit.append(tx, {
        tenantId,
        actorUserId: null,
        actorType: 'SYSTEM',
        action: 'AI_JOB_FAILED',
        resourceType: 'ai_job',
        resourceId: aiJobId,
        outcome: 'FAILED',
        requestId: null,
        // A class and a rule name. Never a provider message and never any retrieved text.
        metadata: { errorClass, reason },
      });
    });
    return { outcome: 'FAILED', errorClass, reason };
  }

  private async wait(
    tenantId: string,
    aiJobId: string,
    retryAt: Date,
    errorClass: string,
    reason: string,
  ): Promise<AIJobReport> {
    const now = this.clock.now();
    await withTransaction(this.deps.prisma, async (tx) => {
      await lockRow(tx, 'ai_jobs', aiJobId, tenantId);
      await tx.aiJob.update({
        where: { id: aiJobId },
        data: {
          status: 'WAITING_RATE_LIMIT',
          errorClass,
          errorReason: reason,
          updatedAt: now,
          rowVersion: { increment: 1 },
        },
      });
    });
    return { outcome: 'WAITING_RATE_LIMIT', errorClass, reason, retryAt };
  }

  private async requeue(
    tenantId: string,
    aiJobId: string,
    errorClass: string,
    reason: string,
  ): Promise<void> {
    const now = this.clock.now();
    await withTransaction(this.deps.prisma, async (tx) => {
      await lockRow(tx, 'ai_jobs', aiJobId, tenantId);
      await tx.aiJob.update({
        where: { id: aiJobId },
        data: {
          status: 'QUEUED',
          errorClass,
          errorReason: reason,
          updatedAt: now,
          rowVersion: { increment: 1 },
        },
      });
    });
  }

  private async cancel(tenantId: string, aiJobId: string, reason: string): Promise<AIJobReport> {
    const now = this.clock.now();
    await withTransaction(this.deps.prisma, async (tx) => {
      await lockRow(tx, 'ai_jobs', aiJobId, tenantId);
      await tx.aiJob.update({
        where: { id: aiJobId },
        data: {
          status: 'CANCELLED',
          finishedAt: now,
          errorClass: 'CANCELLED',
          errorReason: reason,
          updatedAt: now,
          rowVersion: { increment: 1 },
        },
      });
    });
    return { outcome: 'CANCELLED', errorClass: 'CANCELLED', reason };
  }

  /** Not used yet; kept so the hash of a stored raw object can be checked without reading it. */
  static rawOutputDigest(body: string): string {
    return createHash('sha256').update(body, 'utf8').digest('hex');
  }
}
