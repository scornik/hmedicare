import { AppError, type Clock, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, type Tx, isUniqueViolation, lockRow, withTransaction } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import { TenantContextResolver } from '@hmedic/identity-access';
import type { AIProviderRegister } from '../application/providers/provider-register';
import {
  type AIPolicyDecision,
  type AIPolicyInput,
  type DeclaredTier,
  type PolicyCredential,
  evaluateAIPolicy,
} from '../application/policy/effective-policy';
import type { PromptPurpose } from '../application/prompts/template-registry';

/**
 * AI job creation, lookup and cancellation (AI-001, AI-IMPLEMENTATION §6).
 *
 * The HTTP routes own none of these rules. A doctor asks for a draft, and everything that decides
 * whether that is allowed happens here, inside one transaction that re-resolves the live membership —
 * a guard that passed and a transaction that then trusted it would leave a window in which a revoked
 * role still acted.
 *
 * The policy decision is made at creation and **stored on the job**. Provider, model, tier, billing
 * mode and effective data-use policy are all copied onto the row. That is not denormalization for
 * speed: a register change or a tenant policy change a month later must not rewrite what a finished
 * job was permitted to do, because the job's record is the evidence that it was permitted at all.
 *
 * Nothing here calls a provider. The job is queued and the runner does the work, so a request never
 * waits on a vendor and a lost request cannot lose the job.
 */
export interface AIJobActor {
  tenantId: string;
  userId: string;
  requestId?: string;
}

export interface CreateAIJobInput {
  encounterId: string;
  purpose: Extract<PromptPurpose, 'note-draft' | 'history-summary'>;
  /** The doctor's own credential. Omitted means their highest-priority active one. */
  credentialId?: string;
  modelId?: string;
  sourceSelection: {
    draftSections?: readonly string[];
    lookbackDays?: number;
    maxItems?: number;
  };
  templateVersion?: string;
  idempotencyKey: string;
}

const PURPOSE_TO_DB: Record<CreateAIJobInput['purpose'], 'NOTE_DRAFT' | 'HISTORY_SUMMARY'> = {
  'note-draft': 'NOTE_DRAFT',
  'history-summary': 'HISTORY_SUMMARY',
};

type Row = Awaited<ReturnType<PrismaClient['aiJob']['findFirstOrThrow']>>;

export const aiJobView = (row: Row) => ({
  id: row.id,
  purpose: row.purpose,
  status: row.status,
  encounterId: row.encounterId,
  providerCode: row.providerCode,
  modelId: row.modelId,
  declaredTier: row.declaredTier,
  effectiveDataUsePolicy: row.effectiveDataUsePolicy,
  promptTemplateVersion: row.promptTemplateVersion,
  errorClass: row.errorClass,
  errorReason: row.errorReason,
  cancelRequestedAt: row.cancelRequestedAt?.toISOString() ?? null,
  startedAt: row.startedAt?.toISOString() ?? null,
  finishedAt: row.finishedAt?.toISOString() ?? null,
  rowVersion: row.rowVersion,
});

export class AIJobStore {
  private readonly clock: Clock;
  constructor(
    private readonly deps: {
      prisma: PrismaClient;
      audit: PrismaAuditPort;
      providers: AIProviderRegister;
      environment: 'development' | 'test' | 'staging' | 'production';
      enabledProviderCodes: readonly string[];
      currentAckTextVersion: string;
      platformManagedEnabled?: boolean;
      freeTierProductionGateClosed?: boolean;
      transcriptionEnabled?: boolean;
      /** The queue row the runner claims. Null in a deployment with no runner composed. */
      enqueue?: (
        tx: Tx,
        job: { tenantId: string; aiJobId: string; correlationId: string },
      ) => Promise<string>;
      clock?: Clock;
    },
  ) {
    this.clock = deps.clock ?? systemClock;
  }

  /**
   * Resolves the actor and the encounter together.
   *
   * The doctor must be the encounter's own doctor or cover for them; `ai.use` alone is not enough,
   * because the permission says what a role may do and the assignment says whose patient it is.
   */
  private async authorize(tx: Tx, actor: AIJobActor, encounterId: string) {
    await lockRow(tx, 'tenants', actor.tenantId);
    const context = await new TenantContextResolver(tx).resolve(actor.userId, actor.tenantId);
    if (!context || !(await tx.user.count({ where: { id: actor.userId, status: 'ACTIVE' } }))) {
      throw new AppError('FORBIDDEN');
    }
    if (!context.effectivePermissions.has('ai.use')) throw new AppError('FORBIDDEN');
    const encounter = await tx.encounter.findFirst({
      where: { tenantId: actor.tenantId, id: encounterId },
    });
    if (!encounter) throw new AppError('RESOURCE_NOT_FOUND');
    const doctor = await tx.doctorProfile.findFirst({
      where: { tenantId: actor.tenantId, userId: actor.userId, status: 'ACTIVE' },
    });
    if (!doctor) throw new AppError('FORBIDDEN');
    if (doctor.id !== encounter.doctorProfileId) {
      // A covering doctor is allowed; anyone else is not, however their role is configured.
      const covering = await tx.doctorCoverage.count({
        where: {
          tenantId: actor.tenantId,
          coveringDoctorProfileId: doctor.id,
          coveredDoctorProfileId: encounter.doctorProfileId,
          status: 'ACTIVE',
        },
      });
      if (!covering) throw new AppError('FORBIDDEN');
    }
    if (encounter.status !== 'IN_PROGRESS') {
      // A completed encounter is not a consultation anyone is in; drafting into it would be writing
      // to a closed record.
      throw new AppError('INVALID_TRANSITION', undefined, {
        details: { encounterStatus: encounter.status },
      });
    }
    return { encounter, doctorProfileId: encounter.doctorProfileId, context };
  }

  async create(actor: AIJobActor, input: CreateAIJobInput) {
    if (input.purpose !== 'note-draft' && input.purpose !== 'history-summary') {
      throw new AppError('VALIDATION_FAILED');
    }
    try {
      return await withTransaction(this.deps.prisma, async (tx) => {
        const { encounter, doctorProfileId } = await this.authorize(tx, actor, input.encounterId);

        const credential = await this.pickCredential(tx, actor.tenantId, doctorProfileId, input.credentialId);
        const metadata = this.deps.providers.metadata(
          credential.providerCode,
          credential.declaredTier as DeclaredTier,
        );
        if (!metadata) {
          // No adapter serves this credential in this deployment, so nothing can run the job. The
          // honest answer is a refusal rather than a job that will fail on its first attempt.
          throw new AppError('POLICY_BLOCKED', undefined, { details: { reason: 'PROVIDER_NOT_SERVED' } });
        }

        const policy = await this.policyFor(
          tx,
          actor.tenantId,
          doctorProfileId,
          encounter.patientId,
          credential,
          metadata,
        );
        if (!policy.allowed) {
          throw new AppError('POLICY_BLOCKED', undefined, { details: { reason: policy.reason } });
        }

        /*
         * The model comes from the request, the credential's default, or the catalog — in that order,
         * and from nowhere else. The catalog fallback is not a guess: it is a row a refresh verified
         * against the provider, which is exactly what `hmedic/no-hardcoded-model-id` exists to keep
         * model choice made of. Ordered by id so two jobs queued a second apart pick the same model.
         */
        const named = input.modelId ?? credential.defaultModelId ?? null;
        const usable = await tx.aiModelCatalogEntry.findFirst({
          where: {
            providerCode: credential.providerCode,
            ...(named ? { modelId: named } : {}),
            deprecatedAt: null,
          },
          orderBy: { modelId: 'asc' },
        });
        if (!usable) throw new AppError('MODEL_UNAVAILABLE');
        const tiers = Array.isArray(usable.tierAvailability) ? (usable.tierAvailability as string[]) : [];
        if (tiers.length > 0 && !tiers.includes(credential.declaredTier)) {
          // A model the catalog records for another tier would be a request this key cannot make.
          throw new AppError('MODEL_UNAVAILABLE');
        }
        const modelId = usable.modelId;

        const now = this.clock.now();
        const id = newId();
        const correlationId = actor.requestId ?? newId();
        const row = await tx.aiJob.create({
          data: {
            id,
            tenantId: actor.tenantId,
            requestedByUserId: actor.userId,
            doctorProfileId,
            patientId: encounter.patientId,
            encounterId: input.encounterId,
            purpose: PURPOSE_TO_DB[input.purpose],
            status: 'QUEUED',
            credentialId: credential.id,
            providerCode: credential.providerCode,
            modelId,
            declaredTier: credential.declaredTier,
            billingMode: credential.billingMode,
            // Stored, not recomputed later: the job's record is the evidence it was permitted.
            effectiveDataUsePolicy: policy.dataUsePolicy,
            promptTemplateVersion: input.templateVersion ?? `${input.purpose}/v1`,
            outputSchemaVersion: input.templateVersion ?? `${input.purpose}/v1`,
            sourceSelection: input.sourceSelection as object,
            correlationId,
            idempotencyKey: input.idempotencyKey,
            createdAt: now,
            updatedAt: now,
          },
        });

        const jobId = await this.deps.enqueue?.(tx, {
          tenantId: actor.tenantId,
          aiJobId: id,
          correlationId,
        });
        const withJob = jobId
          ? await tx.aiJob.update({ where: { id }, data: { jobId, updatedAt: now } })
          : row;

        await this.deps.audit.append(tx, {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          actorType: 'USER',
          action: 'AI_JOB_CREATED',
          resourceType: 'ai_job',
          resourceId: id,
          outcome: 'SUCCESS',
          requestId: actor.requestId ?? null,
          // Identifiers and classifications only. The selection is a list of section names, which is
          // not clinical content, but the content itself never reaches an audit row.
          metadata: {
            purpose: PURPOSE_TO_DB[input.purpose],
            providerCode: credential.providerCode,
            modelId,
            declaredTier: credential.declaredTier,
            effectiveDataUsePolicy: policy.dataUsePolicy,
          },
        });
        return aiJobView(withJob);
      });
    } catch (error) {
      if (isUniqueViolation(error, 'uq_ai_job_idempotency')) {
        // A retried request. Returning the first job is what makes the route idempotent.
        const existing = await this.deps.prisma.aiJob.findFirst({
          where: { tenantId: actor.tenantId, idempotencyKey: input.idempotencyKey },
        });
        if (existing) return aiJobView(existing);
      }
      throw error;
    }
  }

  /** The named credential, or the doctor's highest-priority active one. */
  private async pickCredential(tx: Tx, tenantId: string, doctorProfileId: string, credentialId?: string) {
    const credential = await tx.aiProviderCredential.findFirst({
      where: {
        tenantId,
        doctorProfileId,
        ...(credentialId ? { id: credentialId } : {}),
        status: 'ACTIVE',
      },
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    });
    if (!credential) {
      // Either the doctor has no validated key, or the one they named is not active. Both are the
      // same answer to them: nothing here can run.
      throw new AppError('POLICY_BLOCKED', undefined, { details: { reason: 'NO_ACTIVE_CREDENTIAL' } });
    }
    return credential;
  }

  /**
   * Evaluates the policy preconditions for this credential and patient (ADR-017 §3).
   *
   * Consent and acknowledgement are read here rather than only in the runner, so a doctor learns at
   * the moment they ask that something is missing instead of seeing a job fail a minute later. The
   * runner resolves them again before the provider call, because either can be withdrawn in between.
   */
  private async policyFor(
    tx: Tx,
    tenantId: string,
    doctorProfileId: string,
    patientId: string,
    credential: {
      id: string;
      providerCode: string;
      declaredTier: string;
      billingMode: string;
      dataUseAckId: string | null;
    },
    metadata: NonNullable<ReturnType<AIProviderRegister['metadata']>>,
  ): Promise<AIPolicyDecision> {
    const policy = await tx.tenantAiPolicy.findFirst({ where: { tenantId } });
    const ack = credential.dataUseAckId
      ? await tx.aiDataUseAcknowledgement.findFirst({
          where: {
            tenantId,
            id: credential.dataUseAckId,
            revokedAt: null,
            termsTextVersion: this.deps.currentAckTextVersion,
          },
        })
      : null;
    const consent = await tx.patientConsent.findFirst({
      where: {
        tenantId,
        patientId,
        purpose: 'ai_assistance',
        status: 'GRANTED',
        policyVersion: { gte: policy?.minAiConsentPolicyVersion ?? 1 },
      },
    });
    const input: AIPolicyInput = {
      environment: this.deps.environment,
      tenantId,
      doctorProfileId,
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
        doctorProfileId,
        providerCode: credential.providerCode,
        declaredTier: credential.declaredTier as DeclaredTier,
        billingMode: credential.billingMode as PolicyCredential['billingMode'],
        status: 'ACTIVE',
      },
      metadata,
      // The assignment was already established by `authorize`, which refuses anyone who is neither
      // the encounter's doctor nor covering for them.
      assignedDoctor: true,
      patientConsentCurrent: consent !== null,
      acknowledgementCurrent: ack !== null,
      freeTierProductionGateClosed: this.deps.freeTierProductionGateClosed === true,
      // Transcription is the only raw-media path and it is disabled in MVP.
      rawMediaFeatureEnabled: this.deps.transcriptionEnabled === true,
      // Outside production every environment is synthetic by policy, which is what lets a
      // SYNTHETIC_DATA_ONLY provider run at all.
      syntheticData: this.deps.environment !== 'production',
      ...(this.deps.platformManagedEnabled !== undefined
        ? { platformManagedEnabled: this.deps.platformManagedEnabled }
        : {}),
    };
    return evaluateAIPolicy(input);
  }

  async get(actor: AIJobActor, id: string) {
    const row = await this.deps.prisma.aiJob.findFirst({ where: { tenantId: actor.tenantId, id } });
    if (!row) throw new AppError('RESOURCE_NOT_FOUND');
    return withTransaction(this.deps.prisma, async (tx) => {
      // The requester or the assigned doctor; nobody else sees that a draft was asked for.
      const doctor = await tx.doctorProfile.findFirst({
        where: { tenantId: actor.tenantId, userId: actor.userId, status: 'ACTIVE' },
      });
      if (row.requestedByUserId !== actor.userId && doctor?.id !== row.doctorProfileId) {
        throw new AppError('FORBIDDEN');
      }
      return aiJobView(row);
    });
  }

  /**
   * Requests cancellation.
   *
   * A queued or waiting job is cancelled outright. A running one is marked, and the runner checks the
   * mark before the provider call and again before persisting — so cancelling never leaves a draft
   * nobody asked for, and never claims to have stopped a call that had already gone out.
   */
  async cancel(actor: AIJobActor, id: string) {
    return withTransaction(this.deps.prisma, async (tx) => {
      await lockRow(tx, 'ai_jobs', id, actor.tenantId);
      const row = await tx.aiJob.findFirst({ where: { tenantId: actor.tenantId, id } });
      if (!row) throw new AppError('RESOURCE_NOT_FOUND');
      if (row.requestedByUserId !== actor.userId) {
        const doctor = await tx.doctorProfile.findFirst({
          where: { tenantId: actor.tenantId, userId: actor.userId, status: 'ACTIVE' },
        });
        if (doctor?.id !== row.doctorProfileId) throw new AppError('FORBIDDEN');
      }
      if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(row.status)) {
        // Already over. Reporting success here would claim to have stopped something that finished.
        throw new AppError('INVALID_TRANSITION', undefined, { details: { status: row.status } });
      }
      const now = this.clock.now();
      const cancelledNow = row.status !== 'RUNNING';
      const updated = await tx.aiJob.update({
        where: { id },
        data: {
          cancelRequestedAt: row.cancelRequestedAt ?? now,
          ...(cancelledNow
            ? {
                status: 'CANCELLED',
                finishedAt: now,
                errorClass: 'CANCELLED',
                errorReason: 'DOCTOR_CANCELLED',
              }
            : {}),
          updatedAt: now,
          rowVersion: { increment: 1 },
        },
      });
      await this.deps.audit.append(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        actorType: 'USER',
        action: 'AI_JOB_CANCEL_REQUESTED',
        resourceType: 'ai_job',
        resourceId: id,
        outcome: 'SUCCESS',
        requestId: actor.requestId ?? null,
        metadata: { previousStatus: row.status, status: updated.status },
      });
      return aiJobView(updated);
    });
  }

  /**
   * Cancels a doctor's pending jobs when an encounter completes.
   *
   * System action, driven by the encounter rather than a request. A draft produced after the
   * consultation ended has nowhere to go: the note is signed or the doctor has moved on.
   */
  async cancelForCompletedEncounter(tenantId: string, encounterId: string): Promise<number> {
    const now = this.clock.now();
    return withTransaction(this.deps.prisma, async (tx) => {
      const rows = await tx.aiJob.findMany({
        where: { tenantId, encounterId, status: { in: ['QUEUED', 'WAITING_RATE_LIMIT'] } },
      });
      for (const row of rows) {
        await lockRow(tx, 'ai_jobs', row.id, tenantId);
        await tx.aiJob.update({
          where: { id: row.id },
          data: {
            status: 'CANCELLED',
            cancelRequestedAt: row.cancelRequestedAt ?? now,
            finishedAt: now,
            errorClass: 'CANCELLED',
            errorReason: 'ENCOUNTER_COMPLETED',
            updatedAt: now,
            rowVersion: { increment: 1 },
          },
        });
        await this.deps.audit.append(tx, {
          tenantId,
          actorUserId: null,
          actorType: 'SYSTEM',
          action: 'AI_JOB_CANCELLED',
          resourceType: 'ai_job',
          resourceId: row.id,
          outcome: 'SUCCESS',
          requestId: null,
          metadata: { reason: 'ENCOUNTER_COMPLETED', previousStatus: row.status },
        });
      }
      return rows.length;
    });
  }
}
