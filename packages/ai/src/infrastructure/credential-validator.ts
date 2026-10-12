import { type Clock, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, lockRow, withTransaction } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import { OutboxPort } from '@hmedic/jobs';
import type { DeclaredTier } from '../application/policy/effective-policy';
import type { AICredentialSecrets } from '../application/credentials/credential-secrets';
import { decideValidationOutcome } from '../application/credentials/validation-outcome';
import type { AIErrorClass } from '../application/providers/ai-provider-port';
import type { AIProviderRegister } from '../application/providers/provider-register';
import { type AICredentialStatus, nextAICredentialStatus } from '../domain/credential';

/**
 * `ValidateAICredential`'s use case (AICRED-004, ADR-017 §4).
 *
 * Saving a key creates the credential `PENDING_VALIDATION`; this makes the one provider call that
 * proves the key works and settles the status every later policy decision reads. It sends nothing
 * clinical — validation exists precisely so a key is exercised before any patient data depends on it.
 *
 * Three properties matter more than the mapping itself.
 *
 * **No transaction is held across the provider call.** A network call inside a transaction holds row
 * locks for as long as a vendor takes to answer, which on a slow provider is how a tenant's writes
 * stall. The status is read before the call and re-read under a lock before it is written.
 *
 * **Revocation wins.** ADR-017 §4 makes revocation immediate, so a credential that left
 * `PENDING_VALIDATION` while the provider was answering is not written to: the attempt's result is
 * discarded rather than resurrecting a status the doctor has already moved on from.
 *
 * **An inconclusive attempt moves nothing.** A transport failure or a timeout says nothing about the
 * key, and `INVALID` on that evidence would disable a working credential on a network blip. The job
 * retries instead, and `last_error_class` records what happened without changing the status.
 */
export interface ValidationReport {
  outcome: 'ACTIVATED' | 'SETTLED' | 'RESCHEDULED' | 'BLOCKED' | 'INCONCLUSIVE' | 'SKIPPED';
  status: AICredentialStatus | null;
  errorClass?: AIErrorClass | 'POLICY_BLOCKED' | 'PROVIDER_NOT_SERVED';
  reason?: string;
  /** Set on `RESCHEDULED`: when the provider said it would stop refusing. */
  retryAt?: Date;
}

export class AICredentialValidator {
  private readonly clock: Clock;
  private readonly outbox: OutboxPort;
  constructor(
    private readonly deps: {
      prisma: PrismaClient;
      audit: PrismaAuditPort;
      secrets: AICredentialSecrets;
      providers: AIProviderRegister;
      environment: string;
      clock?: Clock;
    },
  ) {
    this.clock = deps.clock ?? systemClock;
    this.outbox = new OutboxPort(this.clock);
  }

  async validate(tenantId: string, credentialId: string): Promise<ValidationReport> {
    const row = await this.deps.prisma.aiProviderCredential.findFirst({
      where: { tenantId, id: credentialId },
    });
    if (!row) {
      // Deleted, or another tenant's id. Nothing a retry fixes, and the caller reports it.
      return { outcome: 'SKIPPED', status: null, reason: 'CREDENTIAL_NOT_FOUND' };
    }
    if (row.status !== 'PENDING_VALIDATION') {
      // Disabled, revoked or already settled between enqueue and run. Succeed having done nothing.
      return { outcome: 'SKIPPED', status: row.status as AICredentialStatus };
    }

    const provider = this.deps.providers.get(row.providerCode);
    if (!provider) {
      // No adapter serves this code in this deployment, which is the production case until a vendor
      // adapter ships. Leaving the status alone is right: the key may be fine, nothing can ask.
      return this.recordAttempt(tenantId, credentialId, {
        outcome: 'INCONCLUSIVE',
        errorClass: 'PROVIDER_NOT_SERVED',
      });
    }

    const declaredTier = row.declaredTier as DeclaredTier;
    const metadata = this.deps.providers.metadata(row.providerCode, declaredTier);
    if (this.deps.environment === 'production' && metadata?.productionGate !== 'CLOSED') {
      // ADR-017 §6: a `(provider, tier)` whose gate is open cannot become ACTIVE in production, and
      // there is no runtime override — the gate closes only by changing adapter metadata and the
      // register together in a reviewed change. Refuse before the call, not after: the point of the
      // gate is that nothing is sent.
      return this.recordAttempt(tenantId, credentialId, {
        outcome: 'SETTLED_BLOCKED',
        errorClass: 'POLICY_BLOCKED',
        reason: 'PROVIDER_PRODUCTION_GATE_OPEN',
      });
    }

    const scope = {
      credentialId: row.id,
      tenantId: row.tenantId,
      doctorProfileId: row.doctorProfileId,
      providerCode: row.providerCode,
    };
    let result;
    try {
      result = await this.deps.secrets.use(scope, row, async (apiKey) =>
        provider.validate({
          credentialId: row.id,
          providerCode: row.providerCode,
          declaredTier,
          // The key is lent for the duration of this call only; it is never a field the adapter keeps.
          withKey: (fn) => fn(apiKey),
        }),
      );
    } catch (error) {
      // `AICredentialSecrets` normalizes both an unusable envelope and an adapter that threw. Neither
      // says the key is wrong, so neither moves the status.
      const code = (error as { code?: string }).code;
      return this.recordAttempt(tenantId, credentialId, {
        outcome: 'INCONCLUSIVE',
        errorClass: 'PROVIDER_ERROR',
        reason: code === 'SECRET_UNAVAILABLE' ? 'SECRET_UNAVAILABLE' : 'PROVIDER_CALL_FAILED',
      });
    }

    const decision = decideValidationOutcome({ declaredTier, result });
    if (decision.kind === 'RETRY') {
      return this.recordAttempt(tenantId, credentialId, {
        outcome: 'INCONCLUSIVE',
        errorClass: decision.errorClass,
      });
    }
    if (decision.kind === 'RESCHEDULE') {
      // The credential stays PENDING_VALIDATION, which is what lets the rescheduled attempt do
      // anything at all: a settled status would make the next run skip and the wait pointless.
      return this.recordAttempt(tenantId, credentialId, {
        outcome: 'RESCHEDULE',
        errorClass: decision.errorClass,
        retryAfterSeconds: decision.retryAfterSeconds,
      });
    }
    return this.recordAttempt(tenantId, credentialId, {
      outcome: 'SETTLE',
      action: decision.action,
      ...(decision.tierConfirmed !== undefined ? { tierConfirmed: decision.tierConfirmed } : {}),
      ...(decision.errorClass ? { errorClass: decision.errorClass } : {}),
    });
  }

  /**
   * Writes the attempt's result under a lock, re-reading the status first.
   *
   * `INCONCLUSIVE` and the production-gate refusal record `last_error_class` without a transition, so
   * the doctor's screen can say why nothing happened. Everything else transitions through
   * `nextAICredentialStatus`, which is the one place credential state moves.
   */
  private async recordAttempt(
    tenantId: string,
    credentialId: string,
    attempt:
      | {
          outcome: 'INCONCLUSIVE' | 'SETTLED_BLOCKED';
          errorClass: ValidationReport['errorClass'];
          reason?: string;
        }
      | { outcome: 'RESCHEDULE'; errorClass: AIErrorClass; reason?: string; retryAfterSeconds: number }
      | {
          outcome: 'SETTLE';
          action: Parameters<typeof nextAICredentialStatus>[1];
          tierConfirmed?: boolean;
          errorClass?: AIErrorClass;
          reason?: string;
        },
  ): Promise<ValidationReport> {
    return withTransaction(this.deps.prisma, async (tx) => {
      await lockRow(tx, 'ai_provider_credentials', credentialId, tenantId);
      const current = await tx.aiProviderCredential.findFirst({
        where: { tenantId, id: credentialId },
      });
      if (!current) return { outcome: 'SKIPPED', status: null, reason: 'CREDENTIAL_NOT_FOUND' };
      if (current.status !== 'PENDING_VALIDATION') {
        // Revoked or disabled while the provider was answering. ADR-017 §4: revocation is immediate
        // and results obtained after it are discarded.
        return { outcome: 'SKIPPED', status: current.status as AICredentialStatus };
      }

      const now = this.clock.now();
      const settling = attempt.outcome === 'SETTLE';
      let status = current.status as AICredentialStatus;
      if (settling) {
        // A transition this domain refuses is a programming error here, not a provider answer, so it
        // is left to throw rather than quietly written as something else.
        status = nextAICredentialStatus(status, attempt.action);
      }
      const activated = status === 'ACTIVE';
      const row = await tx.aiProviderCredential.update({
        where: { id: credentialId },
        data: {
          status,
          ...(activated ? { validatedAt: now } : {}),
          // A confirmation nobody made must not be shown, so this only drops to false where the
          // provider actually reported an agreeing tier.
          ...(attempt.outcome === 'SETTLE' && attempt.tierConfirmed === true
            ? { tierSelfDeclared: false }
            : {}),
          lastErrorClass: activated ? null : (attempt.errorClass ?? null),
          lastErrorReason: activated ? null : (attempt.reason ?? null),
          updatedAt: now,
          ...(settling ? { rowVersion: { increment: 1 } } : {}),
        },
      });
      const eventName = activated
        ? 'AICredentialValidated'
        : settling
          ? 'AICredentialValidationFailed'
          : attempt.outcome === 'SETTLED_BLOCKED'
            ? 'AICredentialValidationBlocked'
            : attempt.outcome === 'RESCHEDULE'
              ? 'AICredentialValidationDeferred'
              : 'AICredentialValidationInconclusive';
      await this.outbox.append(tx, {
        tenantId,
        eventName,
        eventVersion: 1,
        aggregateType: 'ai_credential',
        aggregateId: credentialId,
        correlationId: newId(),
        causationId: null,
        actorId: null,
        idempotencyKey: null,
        payload: { credentialId, status: row.status, errorClass: attempt.errorClass ?? null },
      });
      await this.deps.audit.append(tx, {
        tenantId,
        actorUserId: null,
        actorType: 'SYSTEM',
        action: eventName
          .replace(/^AI/, 'Ai')
          .replace(/([a-z])([A-Z])/g, '$1_$2')
          .toUpperCase(),
        resourceType: 'ai_credential',
        resourceId: credentialId,
        outcome: activated ? 'SUCCESS' : 'FAILED',
        requestId: null,
        // Provider code and error class only. A provider message may quote the request, and the key
        // never reaches here at all.
        metadata: {
          providerCode: row.providerCode,
          status: row.status,
          errorClass: attempt.errorClass ?? null,
          reason: attempt.reason ?? null,
        },
      });

      if (attempt.outcome === 'RESCHEDULE') {
        return {
          outcome: 'RESCHEDULED',
          status: row.status as AICredentialStatus,
          errorClass: attempt.errorClass,
          retryAt: new Date(now.getTime() + attempt.retryAfterSeconds * 1000),
        };
      }
      if (attempt.outcome === 'SETTLE') {
        return {
          outcome: activated ? 'ACTIVATED' : 'SETTLED',
          status: row.status as AICredentialStatus,
          ...(attempt.errorClass ? { errorClass: attempt.errorClass } : {}),
        };
      }
      return {
        outcome: attempt.outcome === 'SETTLED_BLOCKED' ? 'BLOCKED' : 'INCONCLUSIVE',
        status: row.status as AICredentialStatus,
        errorClass: attempt.errorClass,
        ...(attempt.reason ? { reason: attempt.reason } : {}),
      };
    });
  }
}
