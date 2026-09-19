import { AppError, type Clock, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, type Tx, isUniqueViolation, lockRows, withTransaction } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import { nameSearchTokens, skeletonSimilarity } from '@hmedic/localization';
import type { MergeRepointerRegistry, PatientActor } from '../application/ports';
import type { PatientEvents } from './events';

export interface MergeCaseView {
  id: string;
  sourcePatientId: string;
  targetPatientId: string;
  reason: string;
  duplicateScore: number | null;
  status: string;
  requestedByUserId: string;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  createdAt: string;
  rowVersion: number;
}

/**
 * Patient merge (audit C-47; DATABASE §3.4 `patient_merge_cases`). Opening a case changes nothing. Approval
 * locks both patients (id order), re-points every registered reference (appointments, serials) in the same
 * transaction, marks the source MERGED with `merged_into_patient_id`, and records every re-pointed id in the
 * audit metadata, which makes the merge reversible by audit. The source row is never deleted.
 */
export class MergeService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: PrismaAuditPort,
    private readonly events: PatientEvents,
    private readonly repointers: MergeRepointerRegistry<Tx>,
    private readonly clock: Clock = systemClock,
  ) {}

  private view(m: {
    id: string;
    sourcePatientId: string;
    targetPatientId: string;
    reason: string;
    duplicateScore: { toString(): string } | null;
    status: string;
    requestedByUserId: string;
    reviewedByUserId: string | null;
    reviewedAt: Date | null;
    createdAt: Date;
    rowVersion: number;
  }): MergeCaseView {
    return {
      id: m.id,
      sourcePatientId: m.sourcePatientId,
      targetPatientId: m.targetPatientId,
      reason: m.reason,
      duplicateScore: m.duplicateScore === null ? null : Number(m.duplicateScore.toString()),
      status: m.status,
      requestedByUserId: m.requestedByUserId,
      reviewedByUserId: m.reviewedByUserId,
      reviewedAt: m.reviewedAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
      rowVersion: m.rowVersion,
    };
  }

  async list(
    actor: PatientActor,
    input: { status?: string; cursor?: string; limit?: number },
  ): Promise<{ items: MergeCaseView[]; nextCursor: string | null; hasMore: boolean }> {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const rows = await this.prisma.patientMergeCase.findMany({
      where: {
        tenantId: actor.tenant.tenantId,
        ...(input.status ? { status: input.status } : {}),
        ...(input.cursor ? { id: { lt: input.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map((r) => this.view(r)),
      nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
      hasMore: rows.length > limit,
    };
  }

  async open(
    actor: PatientActor,
    sourcePatientId: string,
    input: { targetPatientId: string; reason: string },
  ): Promise<MergeCaseView> {
    const tenantId = actor.tenant.tenantId;
    if (sourcePatientId === input.targetPatientId) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fieldErrors: [{ path: 'targetPatientId', code: 'same_patient', message: 'validation.same_patient' }],
      });
    }
    const patients = await this.prisma.patient.findMany({
      where: { tenantId, id: { in: [sourcePatientId, input.targetPatientId] }, status: 'ACTIVE' },
    });
    if (patients.length !== 2) throw new AppError('RESOURCE_NOT_FOUND');
    const src = patients.find((p) => p.id === sourcePatientId)!;
    const tgt = patients.find((p) => p.id === input.targetPatientId)!;
    const score = skeletonSimilarity(
      nameSearchTokens(src.legalName, src.legalNameBn).skeletons,
      nameSearchTokens(tgt.legalName, tgt.legalNameBn).skeletons,
    );
    const now = this.clock.now();
    return withTransaction(this.prisma, async (tx) => {
      let row;
      try {
        row = await tx.patientMergeCase.create({
          data: {
            id: newId(),
            tenantId,
            sourcePatientId,
            targetPatientId: input.targetPatientId,
            reason: input.reason,
            duplicateScore: Math.round(score * 10_000) / 10_000,
            status: 'OPEN',
            requestedByUserId: actor.userId,
            createdAt: now,
            updatedAt: now,
            createdByUserId: actor.userId,
            updatedByUserId: actor.userId,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error, 'uq_merge_open_source')) {
          throw new AppError('DUPLICATE_PATIENT_REVIEW_REQUIRED', 'merge.case_already_open');
        }
        throw error;
      }
      await this.audit.append(tx, {
        tenantId,
        actorUserId: actor.userId,
        actorType: 'USER',
        action: 'PATIENT_MERGE_REQUESTED',
        resourceType: 'patient_merge_case',
        resourceId: row.id,
        outcome: 'SUCCESS',
        requestId: actor.requestId ?? null,
        rolePermissionsVersion: actor.tenant.rolePermissionsVersion,
        metadata: { sourcePatientId, targetPatientId: input.targetPatientId },
      });
      await this.events.emit(tx, {
        tenantId,
        name: 'PatientMergeRequested',
        aggregateType: 'patient_merge_case',
        aggregateId: row.id,
        actorId: actor.userId,
        correlationId: actor.correlationId,
        payload: { mergeCaseId: row.id, sourcePatientId, targetPatientId: input.targetPatientId },
      });
      return this.view(row);
    });
  }

  async approve(actor: PatientActor, caseId: string, expectedRowVersion: number): Promise<MergeCaseView> {
    const tenantId = actor.tenant.tenantId;
    const now = this.clock.now();
    return withTransaction(
      this.prisma,
      async (tx) => {
        const existing = await tx.patientMergeCase.findFirst({ where: { tenantId, id: caseId } });
        if (!existing) throw new AppError('RESOURCE_NOT_FOUND');
        // Lock order (C-46): patients before the merge case.
        const locked = await lockRows(
          tx,
          'patients',
          [existing.sourcePatientId, existing.targetPatientId],
          tenantId,
        );
        if (locked.length !== 2) throw new AppError('RESOURCE_NOT_FOUND');
        await lockRows(tx, 'patient_merge_cases', [caseId], tenantId);
        const m = await tx.patientMergeCase.findUniqueOrThrow({ where: { id: caseId } });
        if (m.rowVersion !== expectedRowVersion) throw new AppError('STALE_VERSION');
        if (m.status !== 'OPEN' && m.status !== 'IN_REVIEW') throw new AppError('INVALID_TRANSITION');
        const [src, tgt] = await Promise.all([
          tx.patient.findUniqueOrThrow({ where: { id: m.sourcePatientId } }),
          tx.patient.findUniqueOrThrow({ where: { id: m.targetPatientId } }),
        ]);
        if (src.status !== 'ACTIVE' || tgt.status !== 'ACTIVE') throw new AppError('INVALID_TRANSITION');

        const repointed: Record<string, string[]> = {};
        for (const r of this.repointers.all()) {
          repointed[r.resource] = await r.repoint(tx, tenantId, src.id, tgt.id);
        }
        await tx.patient.update({
          where: { id: src.id },
          data: {
            status: 'MERGED',
            mergedIntoPatientId: tgt.id,
            updatedAt: now,
            updatedByUserId: actor.userId,
            rowVersion: { increment: 1 },
          },
        });
        await tx.patientSearchToken.deleteMany({ where: { tenantId, patientId: src.id } });
        const row = await tx.patientMergeCase.update({
          where: { id: caseId },
          data: {
            status: 'APPROVED',
            reviewedByUserId: actor.userId,
            reviewedAt: now,
            updatedAt: now,
            updatedByUserId: actor.userId,
            rowVersion: { increment: 1 },
          },
        });
        await this.audit.append(tx, {
          tenantId,
          actorUserId: actor.userId,
          actorType: 'USER',
          action: 'PATIENT_MERGE_APPROVED',
          resourceType: 'patient',
          resourceId: src.id,
          outcome: 'SUCCESS',
          requestId: actor.requestId ?? null,
          rolePermissionsVersion: actor.tenant.rolePermissionsVersion,
          metadata: {
            mergeCaseId: caseId,
            targetPatientId: tgt.id,
            // Flat `resource:id` entries (audit metadata holds scalars and string arrays only).
            repointed: Object.entries(repointed).flatMap(([resource, ids]) =>
              ids.map((id) => `${resource}:${id}`),
            ),
            repointedCount: Object.values(repointed).reduce((n, ids) => n + ids.length, 0),
          },
        });
        await this.events.emit(tx, {
          tenantId,
          name: 'PatientMergeApproved',
          aggregateType: 'patient',
          aggregateId: src.id,
          actorId: actor.userId,
          correlationId: actor.correlationId,
          payload: {
            mergeCaseId: caseId,
            sourcePatientId: src.id,
            targetPatientId: tgt.id,
            repointedCount: Object.values(repointed).reduce((n, ids) => n + ids.length, 0),
          },
        });
        return this.view(row);
      },
      { context: 'patient-merge' },
    );
  }

  async reject(
    actor: PatientActor,
    caseId: string,
    input: { expectedRowVersion: number; reason?: string },
  ): Promise<MergeCaseView> {
    const tenantId = actor.tenant.tenantId;
    const now = this.clock.now();
    return withTransaction(this.prisma, async (tx) => {
      if ((await lockRows(tx, 'patient_merge_cases', [caseId], tenantId)).length !== 1) {
        throw new AppError('RESOURCE_NOT_FOUND');
      }
      const m = await tx.patientMergeCase.findUniqueOrThrow({ where: { id: caseId } });
      if (m.rowVersion !== input.expectedRowVersion) throw new AppError('STALE_VERSION');
      if (m.status !== 'OPEN' && m.status !== 'IN_REVIEW') throw new AppError('INVALID_TRANSITION');
      const row = await tx.patientMergeCase.update({
        where: { id: caseId },
        data: {
          status: 'REJECTED',
          reviewedByUserId: actor.userId,
          reviewedAt: now,
          updatedAt: now,
          updatedByUserId: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.audit.append(tx, {
        tenantId,
        actorUserId: actor.userId,
        actorType: 'USER',
        action: 'PATIENT_MERGE_REJECTED',
        resourceType: 'patient_merge_case',
        resourceId: caseId,
        outcome: 'SUCCESS',
        requestId: actor.requestId ?? null,
        rolePermissionsVersion: actor.tenant.rolePermissionsVersion,
        metadata: { reason: input.reason ?? null },
      });
      return this.view(row);
    });
  }
}
