import { AppError, type Clock, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, type Tx, lockRow, withTransaction } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import type { ClinicalAccessPolicy, ClinicalActor } from '@hmedic/clinical';
import type { AppointmentService, AppointmentView, BookingActor } from '@hmedic/scheduling';
import { OutboxPort } from '@hmedic/jobs';
import { dhakaDate } from '@hmedic/localization';
import { CreateFollowUp, UpdateFollowUp, dueInstant, requireTransition, localDate } from '../domain/plan';

type Plan = Awaited<ReturnType<PrismaClient['followUpPlan']['findFirstOrThrow']>>;
const view = (p: Plan) => ({
  ...p,
  dueStartDate: p.dueStartDate.toISOString().slice(0, 10),
  dueEndDate: p.dueEndDate?.toISOString().slice(0, 10) ?? null,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});
export class FollowUpService {
  private readonly outbox: OutboxPort;
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: PrismaAuditPort,
    private readonly access: ClinicalAccessPolicy,
    private readonly appointments: AppointmentService,
    private readonly clock: Clock = systemClock,
  ) {
    this.outbox = new OutboxPort(clock);
  }
  private async require(tenantId: string, id: string, db: PrismaClient | Tx = this.prisma) {
    const p = await db.followUpPlan.findFirst({ where: { tenantId, id } });
    if (!p) throw new AppError('RESOURCE_NOT_FOUND');
    return p;
  }
  private async assigned(actor: ClinicalActor, id: string) {
    if (!actor.doctorProfileId) throw new AppError('FORBIDDEN');
    const a = await this.access.assigned(actor, id);
    if (a.encounter.status === 'ENTERED_IN_ERROR') throw new AppError('INVALID_TRANSITION');
    return a.encounter;
  }
  private dates(start: string, end: string | null, today: string) {
    if (start < today || (end && end < start)) throw new AppError('VALIDATION_FAILED');
  }
  private async record(
    tx: Tx,
    actor: {
      userId: string;
      requestId?: string;
      correlationId?: string;
      actingAs?: 'SELF' | 'GUARDIAN';
      patientId?: string;
    },
    p: Plan,
    eventName: string,
    key?: string | null,
  ) {
    const correlationId = actor.correlationId ?? actor.requestId ?? newId();
    await this.audit.append(tx, {
      tenantId: p.tenantId,
      actorUserId: actor.userId,
      actorType: actor.actingAs ? 'PATIENT_CONTEXT' : 'USER',
      actingAs: actor.actingAs ?? null,
      onBehalfOfPatientId: actor.patientId ?? null,
      action: eventName.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase(),
      resourceType: 'follow_up_plan',
      resourceId: p.id,
      outcome: 'SUCCESS',
      requestId: actor.requestId ?? null,
      correlationId,
      metadata: { status: p.status, encounterId: p.sourceEncounterId },
    });
    await this.outbox.append(tx, {
      eventName,
      eventVersion: 1,
      tenantId: p.tenantId,
      aggregateType: 'follow_up_plan',
      aggregateId: p.id,
      correlationId,
      causationId: null,
      actorId: actor.userId,
      idempotencyKey: key ? `${key}:${eventName}` : null,
      occurredAt: this.clock.now(),
      payload: { patientId: p.patientId, encounterId: p.sourceEncounterId, status: p.status },
    });
  }
  async list(actor: ClinicalActor, encounterId: string) {
    await this.access.assignedOrScoped(actor, encounterId);
    const rows = await this.prisma.followUpPlan.findMany({
      where: { tenantId: actor.tenant.tenantId, sourceEncounterId: encounterId },
      orderBy: { createdAt: 'asc' },
    });
    await withTransaction(this.prisma, (tx) =>
      this.audit.append(tx, {
        tenantId: actor.tenant.tenantId,
        actorUserId: actor.userId,
        actorType: 'USER',
        action: 'FOLLOW_UP_LIST_VIEWED',
        resourceType: 'encounter',
        resourceId: encounterId,
        outcome: 'SUCCESS',
        requestId: actor.requestId ?? null,
        correlationId: actor.correlationId ?? actor.requestId ?? newId(),
        metadata: { count: rows.length },
      }),
    );
    return rows.map(view);
  }
  async create(
    actor: ClinicalActor,
    encounterId: string,
    raw: unknown,
    key?: string | null,
    onCommit?: (tx: Tx, result: FollowUpView) => Promise<void>,
  ) {
    const parsed = CreateFollowUp.safeParse(raw);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED');
    const input = parsed.data,
      now = this.clock.now();
    this.dates(input.dueStartDate, input.dueEndDate ?? null, dhakaDate(now));
    await this.assigned(actor, encounterId);
    return withTransaction(this.prisma, async (tx) => {
      await lockRow(tx, 'encounters', encounterId, actor.tenant.tenantId);
      const encounter = await this.assigned(actor, encounterId);
      const p = await tx.followUpPlan.create({
        data: {
          id: newId(),
          tenantId: actor.tenant.tenantId,
          patientId: encounter.patientId,
          sourceEncounterId: encounterId,
          doctorProfileId: actor.doctorProfileId!,
          dueStartDate: new Date(input.dueStartDate),
          dueEndDate: input.dueEndDate ? new Date(input.dueEndDate) : null,
          reason: input.reason,
          instructions: input.instructions ?? null,
          status: 'PLANNED',
          createdAt: now,
          updatedAt: now,
          createdByUserId: actor.userId,
          updatedByUserId: actor.userId,
        },
      });
      await tx.followUpTask.create({
        data: {
          id: newId(),
          tenantId: p.tenantId,
          followUpPlanId: p.id,
          taskType: 'REMINDER',
          dueAt: dueInstant(input.dueStartDate),
          status: 'OPEN',
          createdAt: now,
          updatedAt: now,
          createdByUserId: actor.userId,
          updatedByUserId: actor.userId,
        },
      });
      await this.record(tx, actor, p, 'FollowUpPlanCreated', key);
      const result = view(p);
      if (onCommit) await onCommit(tx, result);
      return result;
    });
  }
  async update(actor: ClinicalActor, id: string, raw: unknown) {
    const parsed = UpdateFollowUp.safeParse(raw);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED');
    const input = parsed.data,
      tenantId = actor.tenant.tenantId;
    const before = await this.require(tenantId, id);
    await this.assigned(actor, before.sourceEncounterId);
    return withTransaction(this.prisma, async (tx) => {
      await lockRow(tx, 'follow_up_plans', id, tenantId);
      const p = await this.require(tenantId, id, tx);
      // Encounter lock follows the plan, before any audit chain is allocated.
      await lockRow(tx, 'encounters', p.sourceEncounterId, tenantId);
      await this.assigned(actor, p.sourceEncounterId);
      if (p.rowVersion !== input.expectedRowVersion) throw new AppError('STALE_VERSION');
      if (!['PLANNED', 'BOOKED'].includes(p.status)) throw new AppError('INVALID_TRANSITION');
      if (input.status) requireTransition(p.status, input.status);
      if (p.status === 'BOOKED' && (input.dueStartDate !== undefined || input.dueEndDate !== undefined))
        throw new AppError('INVALID_TRANSITION');
      const start = input.dueStartDate ?? p.dueStartDate.toISOString().slice(0, 10),
        end =
          input.dueEndDate === undefined
            ? (p.dueEndDate?.toISOString().slice(0, 10) ?? null)
            : input.dueEndDate;
      if (input.dueStartDate !== undefined || input.dueEndDate !== undefined)
        this.dates(start, end, dhakaDate(this.clock.now()));
      const now = this.clock.now(),
        changed = await tx.followUpPlan.update({
          where: { id },
          data: {
            reason: input.reason,
            instructions: input.instructions,
            dueStartDate: new Date(start),
            dueEndDate: end ? new Date(end) : null,
            status: input.status,
            updatedAt: now,
            updatedByUserId: actor.userId,
            rowVersion: { increment: 1 },
          },
        });
      await tx.followUpTask.updateMany({
        where: { tenantId, followUpPlanId: id, status: 'OPEN' },
        data: {
          ...(input.status ? { status: 'CANCELLED' } : { dueAt: dueInstant(start) }),
          updatedAt: now,
          updatedByUserId: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.record(tx, actor, changed, 'FollowUpPlanUpdated');
      return view(changed);
    });
  }
  async book(
    actor: BookingActor,
    id: string,
    input: {
      chamberId: string;
      localDate: string;
      careMode: 'PHYSICAL' | 'REMOTE' | 'HYBRID';
      slotId?: string | null;
      expectedRowVersion: number;
    },
    opts: {
      idempotencyKey?: string | null;
      onCommit?: (tx: Tx, view: AppointmentView) => Promise<void>;
    } = {},
  ) {
    if (
      !localDate.safeParse(input.localDate).success ||
      !Number.isInteger(input.expectedRowVersion) ||
      input.expectedRowVersion < 1
    )
      throw new AppError('VALIDATION_FAILED');
    const tenantId = actor.kind === 'staff' ? actor.actor.tenant.tenantId : actor.context.tenantId;
    const before = await this.require(tenantId, id);
    if (actor.kind === 'patient' && actor.context.patientId !== before.patientId)
      throw new AppError('FORBIDDEN');
    return this.appointments.create(
      actor,
      {
        patientId: before.patientId,
        chamberId: input.chamberId,
        localDate: input.localDate,
        careMode: input.careMode,
        slotId: input.slotId,
        source: 'FOLLOW_UP',
        followUpPlanId: id,
      },
      {
        idempotencyKey: opts.idempotencyKey,
        beforeBook: async (tx) => {
          await lockRow(tx, 'follow_up_plans', id, tenantId);
          const p = await this.require(tenantId, id, tx);
          if (p.rowVersion !== input.expectedRowVersion) throw new AppError('STALE_VERSION');
          requireTransition(p.status, 'BOOKED');
          if (
            input.localDate < p.dueStartDate.toISOString().slice(0, 10) ||
            (p.dueEndDate && input.localDate > p.dueEndDate.toISOString().slice(0, 10))
          )
            throw new AppError('VALIDATION_FAILED');
          const ref = await tx.encounter.findFirst({
            where: { tenantId, id: p.sourceEncounterId },
            select: { status: true },
          });
          if (!ref || ref.status === 'ENTERED_IN_ERROR') throw new AppError('INVALID_TRANSITION');
        },
        onCommit: async (tx, appointment) => {
          if (appointment.doctorProfileId !== before.doctorProfileId || !appointment.serial)
            throw new AppError('VALIDATION_FAILED');
          const userId = actor.kind === 'staff' ? actor.actor.userId : actor.context.userId,
            now = this.clock.now();
          const p = await tx.followUpPlan.update({
            where: { id },
            data: {
              status: 'BOOKED',
              appointmentId: appointment.id,
              serialId: appointment.serial.id,
              updatedAt: now,
              updatedByUserId: userId,
              rowVersion: { increment: 1 },
            },
          });
          await tx.followUpTask.updateMany({
            where: { tenantId, followUpPlanId: id, status: 'OPEN', taskType: 'BOOKING_ASSIST' },
            data: { status: 'DONE', updatedAt: now, rowVersion: { increment: 1 } },
          });
          const who =
            actor.kind === 'staff'
              ? actor.actor
              : {
                  userId,
                  requestId: actor.context.requestId,
                  correlationId: actor.context.correlationId,
                  actingAs: actor.context.actingAs,
                  patientId: actor.context.patientId,
                };
          await this.record(tx, who, p, 'FollowUpBooked', opts.idempotencyKey);
          if (opts.onCommit) await opts.onCommit(tx, appointment);
        },
      },
    );
  }
}
export type FollowUpView = ReturnType<typeof view>;
