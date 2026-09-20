import { AppError, type Clock, type FieldError, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, type Tx, lockRow, withTransaction } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import type { SchedulingActor } from '../application/ports';
import { type RuleType, type ScheduleRuleFacts, timeToMinutes, weeklyRulesOverlap } from '../domain/schedule';
import { type ChamberService, assertChamberScope } from './chamber-service';
import type { SchedulingEvents } from './events';

export interface ScheduleRuleView extends ScheduleRuleFacts {
  chamberId: string;
  doctorProfileId: string;
  createdAt: string;
  rowVersion: number;
}

export interface CreateScheduleRuleInput {
  ruleType: RuleType;
  weekday?: number | null;
  exceptionDate?: string | null;
  localStartTime: string;
  localEndTime: string;
  capacity?: number | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

type RuleRow = Awaited<ReturnType<PrismaClient['doctorScheduleRule']['findFirstOrThrow']>>;

const DATE_RE_OK = (s: string) => s.length === 10 && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const dateValue = (s: string) => new Date(`${s}T00:00:00.000Z`);
const dateText = (d: Date) => d.toISOString().slice(0, 10);
const timeValue = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);
const timeText = (d: Date) => d.toISOString().slice(11, 16);
const validation = (fieldErrors: FieldError[]) =>
  new AppError('VALIDATION_FAILED', undefined, { fieldErrors });

export function ruleFacts(r: RuleRow): ScheduleRuleFacts {
  return {
    id: r.id,
    ruleType: r.ruleType as RuleType,
    weekday: r.weekday,
    exceptionDate: r.exceptionDate ? dateText(r.exceptionDate) : null,
    localStartTime: timeText(r.localStartTime),
    localEndTime: timeText(r.localEndTime),
    capacity: r.capacity,
    effectiveFrom: dateText(r.effectiveFrom),
    effectiveTo: r.effectiveTo ? dateText(r.effectiveTo) : null,
  };
}

/**
 * Schedule rules (DATABASE §3.5): weekly templates and dated exceptions (holiday = EXCEPTION_CLOSED,
 * extra session = EXCEPTION_OPEN) per chamber. Overlapping weekly rules for one weekday are refused so a
 * date always resolves to one window (domain `resolveDayWindow`). Rules are ended, never deleted.
 */
export class ScheduleService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: PrismaAuditPort,
    private readonly events: SchedulingEvents,
    private readonly chambers: ChamberService,
    private readonly clock: Clock = systemClock,
  ) {}

  private view(r: RuleRow): ScheduleRuleView {
    return {
      ...ruleFacts(r),
      chamberId: r.chamberId,
      doctorProfileId: r.doctorProfileId,
      createdAt: r.createdAt.toISOString(),
      rowVersion: r.rowVersion,
    };
  }

  /** Rules of a chamber in effect for the given local date range (both ends inclusive). */
  async rulesFor(tenantId: string, chamberId: string, tx?: Tx): Promise<ScheduleRuleFacts[]> {
    const rows = await (tx ?? this.prisma).doctorScheduleRule.findMany({
      where: { tenantId, chamberId },
      orderBy: [{ effectiveFrom: 'asc' }, { localStartTime: 'asc' }],
      take: 500,
    });
    return rows.map(ruleFacts);
  }

  async create(
    actor: SchedulingActor,
    chamberId: string,
    input: CreateScheduleRuleInput,
  ): Promise<ScheduleRuleView> {
    const tenantId = actor.tenant.tenantId;
    const chamber = await this.chambers.require(tenantId, chamberId);
    assertChamberScope(actor, chamber);
    const errors: FieldError[] = [];
    const start = timeToMinutes(input.localStartTime);
    const end = timeToMinutes(input.localEndTime);
    if (start === null)
      errors.push({ path: 'localStartTime', code: 'invalid_time', message: 'validation.invalid_time' });
    if (end === null)
      errors.push({ path: 'localEndTime', code: 'invalid_time', message: 'validation.invalid_time' });
    if (start !== null && end !== null && end <= start)
      errors.push({ path: 'localEndTime', code: 'end_before_start', message: 'validation.end_before_start' });
    if (input.ruleType === 'WEEKLY') {
      if (!input.weekday || input.weekday < 1 || input.weekday > 7)
        errors.push({ path: 'weekday', code: 'weekday_required', message: 'validation.weekday_required' });
    } else if (!input.exceptionDate || !DATE_RE_OK(input.exceptionDate)) {
      errors.push({ path: 'exceptionDate', code: 'date_required', message: 'validation.date_required' });
    }
    if (!DATE_RE_OK(input.effectiveFrom))
      errors.push({ path: 'effectiveFrom', code: 'invalid_date', message: 'validation.invalid_date' });
    if (input.effectiveTo && (!DATE_RE_OK(input.effectiveTo) || input.effectiveTo < input.effectiveFrom))
      errors.push({
        path: 'effectiveTo',
        code: 'before_effective_from',
        message: 'validation.before_effective_from',
      });
    if (
      input.capacity !== undefined &&
      input.capacity !== null &&
      (input.capacity < 1 || input.capacity > 500)
    )
      errors.push({ path: 'capacity', code: 'out_of_range', message: 'validation.out_of_range' });
    if (errors.length) throw validation(errors);

    const candidate: ScheduleRuleFacts = {
      id: 'new',
      ruleType: input.ruleType,
      weekday: input.ruleType === 'WEEKLY' ? input.weekday! : null,
      exceptionDate: input.ruleType === 'WEEKLY' ? null : input.exceptionDate!,
      localStartTime: input.localStartTime,
      localEndTime: input.localEndTime,
      capacity: input.capacity ?? null,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
    };
    const now = this.clock.now();
    const id = newId();
    const row = await withTransaction(this.prisma, async (tx) => {
      await lockRow(tx, 'chambers', chamberId, tenantId); // serializes overlap checks per chamber
      const existing = await this.rulesFor(tenantId, chamberId, tx);
      if (candidate.ruleType === 'WEEKLY' && existing.some((r) => weeklyRulesOverlap(r, candidate))) {
        throw validation([
          { path: 'weekday', code: 'overlapping_rule', message: 'validation.overlapping_rule' },
        ]);
      }
      if (
        candidate.ruleType !== 'WEEKLY' &&
        existing.some(
          (r) =>
            r.ruleType !== 'WEEKLY' && r.exceptionDate === candidate.exceptionDate && r.effectiveTo === null,
        )
      ) {
        throw validation([
          { path: 'exceptionDate', code: 'exception_exists', message: 'validation.exception_exists' },
        ]);
      }
      const r = await tx.doctorScheduleRule.create({
        data: {
          id,
          tenantId,
          chamberId,
          doctorProfileId: chamber.doctorProfileId,
          ruleType: candidate.ruleType,
          weekday: candidate.weekday,
          exceptionDate: candidate.exceptionDate ? dateValue(candidate.exceptionDate) : null,
          localStartTime: timeValue(candidate.localStartTime),
          localEndTime: timeValue(candidate.localEndTime),
          capacity: candidate.capacity,
          effectiveFrom: dateValue(candidate.effectiveFrom),
          effectiveTo: candidate.effectiveTo ? dateValue(candidate.effectiveTo) : null,
          createdAt: now,
          updatedAt: now,
          createdByUserId: actor.userId,
          updatedByUserId: actor.userId,
        },
      });
      await this.audit.append(tx, {
        tenantId,
        actorUserId: actor.userId,
        actorType: 'USER',
        action: 'SCHEDULE_RULE_CREATED',
        resourceType: 'doctor_schedule_rule',
        resourceId: id,
        outcome: 'SUCCESS',
        requestId: actor.requestId ?? null,
        correlationId: actor.correlationId ?? null,
        metadata: { chamberId, ruleType: candidate.ruleType },
      });
      await this.events.emit(tx, {
        tenantId,
        name: 'ScheduleRuleCreated',
        aggregateType: 'doctor_schedule_rule',
        aggregateId: id,
        payload: { ruleId: id, chamberId, ruleType: candidate.ruleType },
        actorId: actor.userId,
        correlationId: actor.correlationId ?? null,
      });
      return r;
    });
    return this.view(row);
  }

  async list(actor: SchedulingActor, chamberId: string): Promise<ScheduleRuleView[]> {
    const tenantId = actor.tenant.tenantId;
    const chamber = await this.chambers.require(tenantId, chamberId);
    assertChamberScope(actor, chamber);
    const rows = await this.prisma.doctorScheduleRule.findMany({
      where: { tenantId, chamberId },
      orderBy: [{ ruleType: 'asc' }, { weekday: 'asc' }, { exceptionDate: 'asc' }, { localStartTime: 'asc' }],
      take: 500,
    });
    return rows.map((r) => this.view(r));
  }

  /** `POST /schedule-rules/{id}/end` (C-43): sets `effective_to`; existing chamber days are untouched. */
  async end(
    actor: SchedulingActor,
    ruleId: string,
    input: { expectedRowVersion: number; effectiveTo: string },
  ): Promise<ScheduleRuleView> {
    const tenantId = actor.tenant.tenantId;
    if (!DATE_RE_OK(input.effectiveTo))
      throw validation([{ path: 'effectiveTo', code: 'invalid_date', message: 'validation.invalid_date' }]);
    const now = this.clock.now();
    const row = await withTransaction(this.prisma, async (tx) => {
      const r = await tx.doctorScheduleRule.findFirst({ where: { tenantId, id: ruleId } });
      if (!r) throw new AppError('RESOURCE_NOT_FOUND');
      const chamber = await this.chambers.require(tenantId, r.chamberId, tx);
      assertChamberScope(actor, chamber);
      await lockRow(tx, 'doctor_schedule_rules', ruleId, tenantId);
      if (r.rowVersion !== input.expectedRowVersion)
        throw new AppError('STALE_VERSION', undefined, { details: { currentRowVersion: r.rowVersion } });
      if (input.effectiveTo < dateText(r.effectiveFrom))
        throw validation([
          { path: 'effectiveTo', code: 'before_effective_from', message: 'validation.before_effective_from' },
        ]);
      const updated = await tx.doctorScheduleRule.update({
        where: { id: ruleId },
        data: {
          effectiveTo: dateValue(input.effectiveTo),
          updatedAt: now,
          updatedByUserId: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.audit.append(tx, {
        tenantId,
        actorUserId: actor.userId,
        actorType: 'USER',
        action: 'SCHEDULE_RULE_ENDED',
        resourceType: 'doctor_schedule_rule',
        resourceId: ruleId,
        outcome: 'SUCCESS',
        requestId: actor.requestId ?? null,
        correlationId: actor.correlationId ?? null,
        metadata: { chamberId: r.chamberId, effectiveTo: input.effectiveTo },
      });
      await this.events.emit(tx, {
        tenantId,
        name: 'ScheduleRuleEnded',
        aggregateType: 'doctor_schedule_rule',
        aggregateId: ruleId,
        payload: { ruleId, chamberId: r.chamberId, effectiveTo: input.effectiveTo },
        actorId: actor.userId,
        correlationId: actor.correlationId ?? null,
      });
      return updated;
    });
    return this.view(row);
  }
}
