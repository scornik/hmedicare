import { AppError, type Clock, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, type Tx, lockRow, withTransaction } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import { OutboxPort } from '@hmedic/jobs';
import { TenantContextResolver } from '@hmedic/identity-access';
import {
  type AIDraftStatus,
  AIDraftTransitionError,
  type AISuggestionStatus,
  type SuggestionDecision,
  draftAcceptsReview,
  draftShouldClose,
  nextSuggestionStatus,
} from '../domain/draft';

/**
 * Draft review (AI-002, AI-IMPLEMENTATION §7.1–§7.2).
 *
 * Everything here is review, and review writes nothing clinical. A doctor reads suggestions, accepts
 * or edits or dismisses them, and none of that reaches a chart; the step that does is
 * `ApproveAISuggestion`, which lives in the clinical context because that is where a record is
 * written.
 *
 * Two rules are worth stating because they are easy to get wrong and expensive when wrong.
 *
 * **A closed or expired draft accepts no further decisions.** Not as a convenience, but because a
 * draft's expiry is the point at which the suggestions stop being about a consultation anyone is in.
 * Approvals already made and the records they created are untouched — closing a draft is not a
 * retraction.
 *
 * **`expectedRowVersion` is required on every decision.** Two doctors covering for each other can
 * both have the draft open, and a decision computed from a stale screen would overwrite one they
 * cannot see. The conflict is reported rather than resolved.
 */
export interface AIDraftActor {
  tenantId: string;
  userId: string;
  requestId?: string;
}

type DraftRow = Awaited<ReturnType<PrismaClient['aiDraft']['findFirstOrThrow']>>;
type SuggestionRow = Awaited<ReturnType<PrismaClient['aiSuggestion']['findFirstOrThrow']>>;

export const aiSuggestionView = (row: SuggestionRow) => ({
  id: row.id,
  suggestionType: row.suggestionType,
  targetSection: row.targetSection,
  sourceRefs: row.sourceRefs,
  candidate: row.candidate,
  editedCandidate: row.editedCandidate,
  confidence: row.confidence,
  status: row.status,
  reviewedAt: row.reviewedAt?.toISOString() ?? null,
  rowVersion: row.rowVersion,
});

export const aiDraftView = (row: DraftRow, suggestions: SuggestionRow[]) => ({
  id: row.id,
  aiJobId: row.aiJobId,
  encounterId: row.encounterId,
  draftType: row.draftType,
  status: row.status,
  outputSchemaVersion: row.outputSchemaVersion,
  droppedUnsourcedCount: row.droppedUnsourcedCount,
  expiresAt: row.expiresAt.toISOString(),
  openedAt: row.openedAt?.toISOString() ?? null,
  closedAt: row.closedAt?.toISOString() ?? null,
  rowVersion: row.rowVersion,
  suggestions: suggestions.map(aiSuggestionView),
});

export class AIDraftStore {
  private readonly clock: Clock;
  private readonly outbox: OutboxPort;
  constructor(private readonly deps: { prisma: PrismaClient; audit: PrismaAuditPort; clock?: Clock }) {
    this.clock = deps.clock ?? systemClock;
    this.outbox = new OutboxPort(this.clock);
  }

  /**
   * The reviewing doctor: the encounter's own, or one covering for them.
   *
   * `ai.review` says what a role may do and the assignment says whose patient it is. Both are
   * required, and both are resolved inside the transaction that acts on them.
   */
  private async authorize(
    tx: Tx,
    actor: AIDraftActor,
    encounterId: string,
    permission: 'ai.review' | 'ai.approve',
  ) {
    await lockRow(tx, 'tenants', actor.tenantId);
    const context = await new TenantContextResolver(tx).resolve(actor.userId, actor.tenantId);
    if (!context || !(await tx.user.count({ where: { id: actor.userId, status: 'ACTIVE' } }))) {
      throw new AppError('FORBIDDEN');
    }
    if (!context.effectivePermissions.has(permission)) throw new AppError('FORBIDDEN');
    const encounter = await tx.encounter.findFirst({
      where: { tenantId: actor.tenantId, id: encounterId },
    });
    if (!encounter) throw new AppError('RESOURCE_NOT_FOUND');
    const doctor = await tx.doctorProfile.findFirst({
      where: { tenantId: actor.tenantId, userId: actor.userId, status: 'ACTIVE' },
    });
    if (!doctor) throw new AppError('FORBIDDEN');
    if (doctor.id !== encounter.doctorProfileId) {
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
    return { doctorProfileId: doctor.id, encounter };
  }

  async get(actor: AIDraftActor, id: string) {
    return withTransaction(this.deps.prisma, async (tx) => {
      const draft = await tx.aiDraft.findFirst({ where: { tenantId: actor.tenantId, id } });
      if (!draft) throw new AppError('RESOURCE_NOT_FOUND');
      await this.authorize(tx, actor, draft.encounterId, 'ai.review');
      const suggestions = await tx.aiSuggestion.findMany({
        where: { tenantId: actor.tenantId, aiDraftId: id },
        orderBy: { id: 'asc' },
      });
      return aiDraftView(draft, suggestions);
    });
  }

  /**
   * Marks the draft as being reviewed.
   *
   * Idempotent: opening one that is already `IN_REVIEW` succeeds and keeps the original `opened_at`,
   * because the first time a doctor looked at it is the fact worth keeping.
   */
  async open(actor: AIDraftActor, id: string) {
    return this.transitionDraft(actor, id, 'OPEN');
  }

  /**
   * Closes the draft.
   *
   * Suggestions still pending stay pending. Closing says the doctor is finished reviewing, not that
   * they rejected the rest, and a record claiming they rejected something they never looked at would
   * be a false statement about a clinician's decision.
   */
  async close(actor: AIDraftActor, id: string) {
    return this.transitionDraft(actor, id, 'CLOSE');
  }

  private async transitionDraft(actor: AIDraftActor, id: string, action: 'OPEN' | 'CLOSE') {
    return withTransaction(this.deps.prisma, async (tx) => {
      const existing = await tx.aiDraft.findFirst({ where: { tenantId: actor.tenantId, id } });
      if (!existing) throw new AppError('RESOURCE_NOT_FOUND');
      await this.authorize(tx, actor, existing.encounterId, 'ai.review');
      await lockRow(tx, 'ai_drafts', id, actor.tenantId);
      const draft = await tx.aiDraft.findFirstOrThrow({ where: { id } });
      const status = draft.status as AIDraftStatus;
      if (!draftAcceptsReview(status)) {
        // An expired draft is about a consultation nobody is in, and a closed one is finished.
        throw new AppError('AI_DRAFT_CLOSED', undefined, { details: { status } });
      }
      const now = this.clock.now();
      const next: AIDraftStatus = action === 'OPEN' ? 'IN_REVIEW' : 'CLOSED';
      if (action === 'OPEN' && status === 'IN_REVIEW') {
        const suggestions = await tx.aiSuggestion.findMany({
          where: { tenantId: actor.tenantId, aiDraftId: id },
          orderBy: { id: 'asc' },
        });
        return aiDraftView(draft, suggestions);
      }
      const updated = await tx.aiDraft.update({
        where: { id },
        data: {
          status: next,
          ...(action === 'OPEN' ? { openedAt: draft.openedAt ?? now } : { closedAt: now }),
          updatedAt: now,
          rowVersion: { increment: 1 },
        },
      });
      await this.record(tx, actor, updated, action === 'OPEN' ? 'AIDraftOpened' : 'AIDraftClosed');
      const suggestions = await tx.aiSuggestion.findMany({
        where: { tenantId: actor.tenantId, aiDraftId: id },
        orderBy: { id: 'asc' },
      });
      return aiDraftView(updated, suggestions);
    });
  }

  /**
   * Records one review decision.
   *
   * The edited candidate is stored beside the model's own rather than replacing it, so an approval can
   * say which of the two the doctor attested — and so a reviewer later can see what the model actually
   * proposed rather than only what was kept.
   */
  async review(
    actor: AIDraftActor,
    id: string,
    input: {
      decision: SuggestionDecision;
      editedCandidate?: unknown;
      expectedRowVersion: number;
    },
  ) {
    if (!Number.isSafeInteger(input.expectedRowVersion) || input.expectedRowVersion < 1) {
      throw new AppError('VALIDATION_FAILED');
    }
    if (input.decision === 'EDIT' && input.editedCandidate === undefined) {
      // An edit with nothing edited is an accept wearing the wrong name, and the two mean different
      // things to the approval that follows.
      throw new AppError('VALIDATION_FAILED', undefined, { details: { reason: 'EDIT_REQUIRES_CANDIDATE' } });
    }
    return withTransaction(this.deps.prisma, async (tx) => {
      const existing = await tx.aiSuggestion.findFirst({ where: { tenantId: actor.tenantId, id } });
      if (!existing) throw new AppError('RESOURCE_NOT_FOUND');
      const draft = await tx.aiDraft.findFirst({
        where: { tenantId: actor.tenantId, id: existing.aiDraftId },
      });
      if (!draft) throw new AppError('RESOURCE_NOT_FOUND');
      const { doctorProfileId } = await this.authorize(tx, actor, draft.encounterId, 'ai.review');

      // Draft first, then suggestion: the lock ranking puts drafts above suggestions, and a decision
      // that closes the draft takes both.
      await lockRow(tx, 'ai_drafts', draft.id, actor.tenantId);
      await lockRow(tx, 'ai_suggestions', id, actor.tenantId);
      const current = await tx.aiSuggestion.findFirstOrThrow({ where: { id } });
      const draftNow = await tx.aiDraft.findFirstOrThrow({ where: { id: draft.id } });
      if (!draftAcceptsReview(draftNow.status as AIDraftStatus)) {
        throw new AppError('AI_DRAFT_CLOSED', undefined, { details: { status: draftNow.status } });
      }
      if (current.rowVersion !== input.expectedRowVersion) throw new AppError('STALE_VERSION');

      let next: AISuggestionStatus;
      try {
        next = nextSuggestionStatus(current.status as AISuggestionStatus, input.decision);
      } catch (error) {
        if (error instanceof AIDraftTransitionError) throw new AppError('INVALID_TRANSITION');
        throw error;
      }

      const now = this.clock.now();
      const updated = await tx.aiSuggestion.update({
        where: { id },
        data: {
          status: next,
          // Cleared on a reopen: a suggestion waiting for the doctor again has no decision on it, and
          // a CHECK on this table refuses PENDING with a reviewer attached.
          ...(next === 'PENDING'
            ? { reviewedAt: null, reviewedByDoctorProfileId: null }
            : { reviewedAt: now, reviewedByDoctorProfileId: doctorProfileId }),
          ...(input.decision === 'EDIT' ? { editedCandidate: input.editedCandidate as object } : {}),
          updatedAt: now,
          rowVersion: { increment: 1 },
        },
      });

      // Opening is implied by the first decision: a doctor deciding something has plainly read it.
      if (draftNow.status === 'READY_FOR_REVIEW') {
        await tx.aiDraft.update({
          where: { id: draft.id },
          data: {
            status: 'IN_REVIEW',
            openedAt: draftNow.openedAt ?? now,
            updatedAt: now,
            rowVersion: { increment: 1 },
          },
        });
      }

      const statuses = (
        await tx.aiSuggestion.findMany({
          where: { tenantId: actor.tenantId, aiDraftId: draft.id },
          select: { status: true },
        })
      ).map((row) => row.status as AISuggestionStatus);
      if (draftShouldClose(statuses)) {
        // Every suggestion is terminal, so there is nothing left to review. Closing it here saves the
        // doctor a second action and makes the draft's state match the work.
        await tx.aiDraft.update({
          where: { id: draft.id },
          data: { status: 'CLOSED', closedAt: now, updatedAt: now, rowVersion: { increment: 1 } },
        });
      }

      await this.deps.audit.append(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        actorType: 'USER',
        action: 'AI_SUGGESTION_REVIEWED',
        resourceType: 'ai_suggestion',
        resourceId: id,
        outcome: 'SUCCESS',
        requestId: actor.requestId ?? null,
        // The decision and the statuses, never the candidate: an audit row holding a suggestion's text
        // would be a second copy of clinical content in a table nobody reads for care.
        metadata: {
          decision: input.decision,
          previousStatus: current.status,
          status: next,
          aiDraftId: draft.id,
          edited: input.decision === 'EDIT',
        },
      });
      return aiSuggestionView(updated);
    });
  }

  private async record(tx: Tx, actor: AIDraftActor, draft: DraftRow, eventName: string) {
    await this.outbox.append(tx, {
      tenantId: actor.tenantId,
      eventName,
      eventVersion: 1,
      aggregateType: 'ai_draft',
      aggregateId: draft.id,
      correlationId: actor.requestId ?? newId(),
      causationId: null,
      actorId: actor.userId,
      idempotencyKey: null,
      payload: { aiDraftId: draft.id, status: draft.status, encounterId: draft.encounterId },
    });
    await this.deps.audit.append(tx, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      actorType: 'USER',
      action: eventName
        .replace(/^AI/, 'Ai')
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .toUpperCase(),
      resourceType: 'ai_draft',
      resourceId: draft.id,
      outcome: 'SUCCESS',
      requestId: actor.requestId ?? null,
      metadata: { status: draft.status, encounterId: draft.encounterId },
    });
  }

  /**
   * Expires drafts past their deadline (§7.1).
   *
   * System action. Expiry is not a cleanup convenience: a draft outliving the consultation it was
   * written for is a set of suggestions about a patient nobody is currently treating, and leaving it
   * reviewable invites a decision made out of context. Approvals already made are untouched.
   */
  async expireDue(limit = 200): Promise<number> {
    const now = this.clock.now();
    const due = await this.deps.prisma.aiDraft.findMany({
      where: { status: { in: ['READY_FOR_REVIEW', 'IN_REVIEW'] }, expiresAt: { lt: now } },
      orderBy: { expiresAt: 'asc' },
      take: limit,
    });
    let expired = 0;
    for (const draft of due) {
      await withTransaction(this.deps.prisma, async (tx) => {
        await lockRow(tx, 'ai_drafts', draft.id, draft.tenantId);
        const current = await tx.aiDraft.findFirst({ where: { id: draft.id } });
        if (!current || !draftAcceptsReview(current.status as AIDraftStatus)) return;
        await tx.aiDraft.update({
          where: { id: draft.id },
          data: {
            status: 'EXPIRED',
            closedAt: now,
            updatedAt: now,
            rowVersion: { increment: 1 },
          },
        });
        await this.deps.audit.append(tx, {
          tenantId: draft.tenantId,
          actorUserId: null,
          actorType: 'SYSTEM',
          action: 'AI_DRAFT_EXPIRED',
          resourceType: 'ai_draft',
          resourceId: draft.id,
          outcome: 'SUCCESS',
          requestId: null,
          metadata: { previousStatus: current.status, expiresAt: current.expiresAt.toISOString() },
        });
        expired += 1;
      });
    }
    return expired;
  }
}
