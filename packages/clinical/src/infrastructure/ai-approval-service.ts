import { createHash } from 'node:crypto';
import { AppError, type Clock, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, lockRow, withTransaction } from '@hmedic/database';
import { ChainAppender, type PrismaAuditPort } from '@hmedic/audit';
import { AI_APPROVAL_CHAIN_PREFIX, approvalHashInput } from '@hmedic/ai';
import { NOTE_SECTIONS, type NoteSection } from '../domain/encounter-transitions';
import type { ClinicalAccessPolicy } from './clinical-access';
import type { DiagnosisService } from './diagnosis-service';
import type { ClinicalActor } from './encounter-service';
import type { NoteService } from './note-service';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
const TX_OPTS = { timeout: 15_000, maxWait: 10_000 } as const;

/**
 * `ApproveAISuggestion` (AI-003, AI-IMPLEMENTATION §7.4).
 *
 * This is the only path by which anything a model produced reaches a patient's chart, and it lives in
 * the clinical context because that is where clinical records are written. `packages/ai` cannot reach
 * these commands and the worker container cannot resolve them, so a draft can never become a record
 * without a doctor doing it here.
 *
 * Everything happens in one transaction: the clinical write, the approval row on the tenant's hash
 * chain, the suggestion's status, the audit entry and the events. An approval that committed
 * separately from the record it created would leave a window in which one existed without the other,
 * and afterwards nobody could say which had happened — the chart would hold a diagnosis labelled
 * `ai_approved` with nothing to justify the label, which the database CHECK refuses outright.
 *
 * What the doctor attested is hashed and stored. `approved_content_sha256` is computed from the exact
 * content that goes into the record, so a later edit of the suggestion cannot be presented as the
 * thing that was approved. The unique `(suggestion_id, suggestion_row_version)` means a double
 * approval cannot land even if two requests race, and `expectedRowVersion` means a doctor approving
 * from a stale screen is told rather than silently overriding a decision they could not see.
 *
 * Only two targets exist in MVP, and the database CHECK allows only those two. A prescription item or
 * a follow-up would each be a different clinical command with its own rules, and refusing them is
 * honest where accepting and ignoring the difference would not be.
 */
export type ApprovalTarget = 'ENCOUNTER_NOTE_SECTION' | 'DIAGNOSIS';

export interface ApproveSuggestionInput {
  approvedTarget: ApprovalTarget;
  expectedRowVersion: number;
  /** The version of the attestation text the doctor was shown. */
  attestationVersion: number;
  noteSection?: {
    section: string;
    mode: 'APPEND' | 'REPLACE';
    text: string;
    /** The note draft's version, so an approval cannot overwrite a save it did not see. */
    expectedNoteRowVersion: number;
  };
  diagnosis?: {
    display: string;
    displayBn?: string | null;
    codeSystem?: string | null;
    code?: string | null;
    certainty: 'CONFIRMED' | 'PROVISIONAL' | 'DIFFERENTIAL';
    clinicalStatus?: 'ACTIVE' | 'RESOLVED' | 'RULED_OUT';
    notes?: string | null;
  };
}

/** The prompt and the suggestions use snake_case section keys; the note columns are camelCase. */
const SECTION_KEYS: Readonly<Record<string, NoteSection>> = {
  chief_complaint: 'chiefComplaint',
  history: 'history',
  examination: 'examination',
  assessment: 'assessment',
  plan: 'plan',
};

export interface AIApprovalView {
  id: string;
  aiSuggestionId: string;
  approvedTarget: ApprovalTarget;
  approvedRecordType: string;
  approvedRecordId: string;
  approvedSection: string | null;
  attestationVersion: number;
  approvedAt: string;
}

export class AIApprovalService {
  private readonly clock: Clock;
  private readonly chain = new ChainAppender();
  constructor(
    private readonly deps: {
      prisma: PrismaClient;
      audit: PrismaAuditPort;
      access: ClinicalAccessPolicy;
      notes: NoteService;
      diagnoses: DiagnosisService;
      clock?: Clock;
    },
  ) {
    this.clock = deps.clock ?? systemClock;
  }

  async approve(
    actor: ClinicalActor,
    suggestionId: string,
    input: ApproveSuggestionInput,
  ): Promise<AIApprovalView> {
    if (!Number.isSafeInteger(input.expectedRowVersion) || input.expectedRowVersion < 1) {
      throw new AppError('VALIDATION_FAILED');
    }
    if (input.approvedTarget === 'ENCOUNTER_NOTE_SECTION' && !input.noteSection) {
      throw new AppError('VALIDATION_FAILED', undefined, { details: { reason: 'NOTE_SECTION_REQUIRED' } });
    }
    if (input.approvedTarget === 'DIAGNOSIS' && !input.diagnosis) {
      throw new AppError('VALIDATION_FAILED', undefined, { details: { reason: 'DIAGNOSIS_REQUIRED' } });
    }

    return withTransaction(
      this.deps.prisma,
      async (tx) => {
        const tenantId = actor.tenant.tenantId;
        const suggestion = await tx.aiSuggestion.findFirst({ where: { tenantId, id: suggestionId } });
        if (!suggestion) throw new AppError('RESOURCE_NOT_FOUND');
        const draft = await tx.aiDraft.findFirst({
          where: { tenantId, id: suggestion.aiDraftId },
        });
        if (!draft) throw new AppError('RESOURCE_NOT_FOUND');

        // Assignment, and `ai.approve` — which the matrix gives to doctors only, so a nurse holding
        // `ai.review` still cannot put anything in a chart.
        const { encounter } = await this.deps.access.assigned(actor, draft.encounterId);
        if (!actor.tenant.effectivePermissions.has('ai.approve')) throw new AppError('FORBIDDEN');
        if (!actor.doctorProfileId) throw new AppError('FORBIDDEN');

        await lockRow(tx, 'ai_drafts', draft.id, tenantId);
        await lockRow(tx, 'ai_suggestions', suggestionId, tenantId);
        const current = await tx.aiSuggestion.findFirstOrThrow({ where: { id: suggestionId } });
        const draftNow = await tx.aiDraft.findFirstOrThrow({ where: { id: draft.id } });

        if (!['READY_FOR_REVIEW', 'IN_REVIEW'].includes(draftNow.status)) {
          throw new AppError('AI_DRAFT_CLOSED', undefined, { details: { status: draftNow.status } });
        }
        if (!['ACCEPTED', 'EDITED'].includes(current.status)) {
          // A doctor cannot approve something they have not said yes to, and cannot approve twice.
          throw new AppError('AI_REVIEW_REQUIRED', undefined, { details: { status: current.status } });
        }
        if (current.rowVersion !== input.expectedRowVersion) throw new AppError('STALE_VERSION');
        if (!this.targetMatches(input.approvedTarget, current.suggestionType)) {
          throw new AppError('VALIDATION_FAILED', undefined, {
            details: { reason: 'TARGET_TYPE_MISMATCH', suggestionType: current.suggestionType },
          });
        }

        const now = this.clock.now();
        const approvalId = newId();

        /*
         * The approval row is written before the clinical record, not after.
         *
         * `diagnoses.ai_approval_id` has a foreign key to `ai_approvals`, so a diagnosis written first
         * would be refused — and that foreign key is the thing that makes `source='ai_approved'`
         * verifiable, so it is not something to give up for a tidier order. The approval therefore
         * names the record it is about to create, and both statements are in this transaction: a
         * failure in either leaves neither.
         */
        const target = await this.resolveTarget(tx, actor, draft.encounterId, input);

        const base = {
          id: approvalId,
          tenantId,
          aiSuggestionId: suggestionId,
          suggestionRowVersion: current.rowVersion,
          approvedTarget: input.approvedTarget,
          approvedRecordType: target.recordType,
          approvedRecordId: target.recordId,
          approvedSection: target.section,
          reviewerDoctorProfileId: actor.doctorProfileId,
          attestationVersion: input.attestationVersion,
          // The content that actually went into the record, so a later edit of the suggestion cannot
          // be presented as the thing that was approved.
          approvedContentSha256: createHash('sha256').update(target.content, 'utf8').digest('hex'),
          approvedAt: now,
        };
        // The sequence number comes from the chain head, so the hashed input is built inside the
        // appender rather than guessed beforehand.
        await this.chain.append(
          tx,
          `${AI_APPROVAL_CHAIN_PREFIX}${tenantId}`,
          now,
          (slot) => approvalHashInput({ ...base, seq: Number(slot.seq) }),
          async (slot, rowHash) =>
            tx.aiApproval.create({
              data: { ...base, seq: Number(slot.seq), prevRowHash: slot.prevRowHash, rowHash },
            }),
        );

        // Now the clinical record, with the approval already in place to justify it.
        await (input.approvedTarget === 'DIAGNOSIS'
          ? this.writeDiagnosis(tx, actor, draft.encounterId, approvalId, target.recordId, input)
          : this.writeNoteSection(tx, actor, draft.encounterId, approvalId, input));

        await tx.aiSuggestion.update({
          where: { id: suggestionId },
          data: {
            status: 'APPROVED',
            reviewedAt: now,
            reviewedByDoctorProfileId: actor.doctorProfileId,
            updatedAt: now,
            rowVersion: { increment: 1 },
          },
        });

        // Closing when nothing is left to review, the same rule the review store applies.
        const statuses = (
          await tx.aiSuggestion.findMany({
            where: { tenantId, aiDraftId: draft.id },
            select: { status: true },
          })
        ).map((entry) => entry.status);
        if (statuses.every((status) => ['APPROVED', 'REJECTED', 'IGNORED'].includes(status))) {
          await tx.aiDraft.update({
            where: { id: draft.id },
            data: { status: 'CLOSED', closedAt: now, updatedAt: now, rowVersion: { increment: 1 } },
          });
        } else if (draftNow.status === 'READY_FOR_REVIEW') {
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

        await this.deps.audit.append(tx, {
          tenantId,
          actorUserId: actor.userId,
          actorType: 'USER',
          action: 'AI_SUGGESTION_APPROVED',
          resourceType: 'ai_suggestion',
          resourceId: suggestionId,
          outcome: 'SUCCESS',
          requestId: actor.requestId ?? null,
          correlationId: actor.correlationId ?? actor.requestId ?? null,
          // Identifiers and the content hash. The approved text lives in the record it created, and a
          // second copy in the audit trail would be clinical content in a table nobody reads for care.
          metadata: {
            aiApprovalId: approvalId,
            aiDraftId: draft.id,
            approvedTarget: input.approvedTarget,
            approvedRecordType: target.recordType,
            approvedRecordId: target.recordId,
            approvedSection: target.section,
            attestationVersion: input.attestationVersion,
            approvedContentSha256: base.approvedContentSha256,
            encounterId: encounter.id,
          },
        });

        return {
          id: approvalId,
          aiSuggestionId: suggestionId,
          approvedTarget: input.approvedTarget,
          approvedRecordType: target.recordType,
          approvedRecordId: target.recordId,
          approvedSection: target.section,
          attestationVersion: input.attestationVersion,
          approvedAt: now.toISOString(),
        };
      },
      { ...TX_OPTS, context: 'ai:approve' },
    );
  }

  /**
   * Whether the requested target can carry this suggestion type.
   *
   * A note-section suggestion approved as a diagnosis would put a paragraph of prose into the
   * diagnosis list, and the other way round would bury a diagnosis in a note section where nothing
   * downstream can find it.
   */
  private targetMatches(target: ApprovalTarget, suggestionType: string): boolean {
    if (target === 'DIAGNOSIS') return suggestionType === 'DIAGNOSIS';
    return suggestionType === 'NOTE_SECTION' || suggestionType === 'HISTORY_ITEM';
  }

  /**
   * Works out what record the approval will name, without writing anything.
   *
   * For a diagnosis that means minting its id, because the approval has to exist before the row that
   * points at it. For a note section it means finding the draft note, which already exists. The
   * attested content is settled here too, so the hash is of what the doctor approved rather than of
   * whatever the write ended up doing.
   */
  private async resolveTarget(
    tx: Tx,
    actor: ClinicalActor,
    encounterId: string,
    input: ApproveSuggestionInput,
  ): Promise<{ recordType: string; recordId: string; section: string | null; content: string }> {
    if (input.approvedTarget === 'DIAGNOSIS') {
      const diagnosis = input.diagnosis!;
      return {
        recordType: 'diagnosis',
        recordId: newId(),
        section: null,
        // The display text is what the doctor attested; the code travels with it where there is one.
        content: JSON.stringify({
          display: diagnosis.display.trim(),
          codeSystem: diagnosis.codeSystem ?? null,
          code: diagnosis.code ?? null,
          certainty: diagnosis.certainty,
        }),
      };
    }
    const requested = input.noteSection!;
    const section = SECTION_KEYS[requested.section];
    if (!section || !NOTE_SECTIONS.includes(section)) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        details: { reason: 'UNKNOWN_SECTION', section: requested.section },
      });
    }
    const note = await tx.encounterNote.findFirst({
      where: { tenantId: actor.tenant.tenantId, encounterId },
      select: { id: true },
    });
    if (!note) throw new AppError('RESOURCE_NOT_FOUND');
    /*
     * The note row is locked here rather than where it is written, because of lock ordering. Appending
     * the approval locks the tenant's chain checkpoint, which ranks above every clinical table, so the
     * note has to be taken before that — otherwise two approvals in different tenants could take
     * `encounter_notes` and `integrity_chain_checkpoints` in opposite orders and deadlock.
     *
     * `applyApprovedSection` locks the same row again, which the lock tracker treats as already held.
     */
    await lockRow(tx, 'encounter_notes', note.id, actor.tenant.tenantId);
    return {
      recordType: 'encounter_note',
      recordId: note.id,
      section: requested.section,
      content: requested.text.trim(),
    };
  }

  private async writeDiagnosis(
    tx: Tx,
    actor: ClinicalActor,
    encounterId: string,
    aiApprovalId: string,
    diagnosisId: string,
    input: ApproveSuggestionInput,
  ) {
    const diagnosis = input.diagnosis!;
    await this.deps.diagnoses.addFromApproval(tx, actor, {
      id: diagnosisId,
      encounterId,
      aiApprovalId,
      display: diagnosis.display,
      ...(diagnosis.displayBn !== undefined ? { displayBn: diagnosis.displayBn } : {}),
      ...(diagnosis.codeSystem !== undefined ? { codeSystem: diagnosis.codeSystem } : {}),
      ...(diagnosis.code !== undefined ? { code: diagnosis.code } : {}),
      certainty: diagnosis.certainty,
      ...(diagnosis.clinicalStatus !== undefined ? { clinicalStatus: diagnosis.clinicalStatus } : {}),
      ...(diagnosis.notes !== undefined ? { notes: diagnosis.notes } : {}),
    });
  }

  private async writeNoteSection(
    tx: Tx,
    actor: ClinicalActor,
    encounterId: string,
    aiApprovalId: string,
    input: ApproveSuggestionInput,
  ) {
    const requested = input.noteSection!;
    const section = SECTION_KEYS[requested.section]!;
    await this.deps.notes.applyApprovedSection(tx, actor, {
      encounterId,
      section,
      text: requested.text,
      mode: requested.mode,
      expectedRowVersion: requested.expectedNoteRowVersion,
      aiApprovalId,
    });
  }
}
