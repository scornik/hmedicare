import { AppError, type Clock, type FieldError, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, type Tx, lockRow, withTransaction } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import type { SchedulingActor } from '../application/ports';
import type {
  CareMode,
  ChamberBookingFacts,
  ChamberPaymentMode,
  TelemedicinePaymentMode,
} from '../domain/booking-rules';
import {
  type QueuePolicy,
  type QueuePolicyPatch,
  policyProblems,
  resolveQueuePolicy,
} from '../domain/queue-policy';
import type { SchedulingEvents } from './events';

export interface ChamberView {
  id: string;
  clinicId: string;
  doctorProfileId: string;
  doctorDisplayName: string;
  name: string;
  supportsPhysical: boolean;
  supportsRemote: boolean;
  supportsHybrid: boolean;
  defaultQueuePolicy: QueuePolicy;
  status: 'ACTIVE' | 'INACTIVE';
  chamberPaymentMode: ChamberPaymentMode;
  telemedicinePaymentMode: TelemedicinePaymentMode;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

export interface CreateChamberInput {
  clinicId: string;
  doctorProfileId: string;
  name: string;
  supportsPhysical: boolean;
  supportsRemote: boolean;
  supportsHybrid: boolean;
  defaultQueuePolicy?: QueuePolicyPatch;
  chamberPaymentMode?: ChamberPaymentMode;
  telemedicinePaymentMode?: TelemedicinePaymentMode;
}

export interface UpdateChamberInput {
  expectedRowVersion: number;
  name?: string;
  supportsPhysical?: boolean;
  supportsRemote?: boolean;
  supportsHybrid?: boolean;
  defaultQueuePolicy?: QueuePolicyPatch;
  status?: 'ACTIVE' | 'INACTIVE';
  chamberPaymentMode?: ChamberPaymentMode;
  telemedicinePaymentMode?: TelemedicinePaymentMode;
}

type ChamberRow = Awaited<ReturnType<PrismaClient['chamber']['findFirstOrThrow']>>;

const validation = (fieldErrors: FieldError[]) =>
  new AppError('VALIDATION_FAILED', undefined, { fieldErrors });

/** Membership clinic/chamber scope (AUTHORIZATION-MATRIX §2 resource scope): empty lists mean "all". */
export function assertClinicScope(actor: SchedulingActor, clinicId: string): void {
  const ids = actor.tenant.clinicIds;
  if (ids.length > 0 && !ids.includes(clinicId)) throw new AppError('FORBIDDEN');
}

export function assertChamberScope(actor: SchedulingActor, chamber: { id: string; clinicId: string }): void {
  assertClinicScope(actor, chamber.clinicId);
  const ids = actor.tenant.chamberIds;
  if (ids.length > 0 && !ids.includes(chamber.id)) throw new AppError('FORBIDDEN');
}

/** Booking-relevant chamber facts with typed payment modes (domain `paymentTermsFor`). */
export function bookingFacts(chamber: ChamberRow): ChamberBookingFacts {
  return {
    supportsPhysical: chamber.supportsPhysical,
    supportsRemote: chamber.supportsRemote,
    supportsHybrid: chamber.supportsHybrid,
    chamberPaymentMode: chamber.chamberPaymentMode as ChamberPaymentMode,
    telemedicinePaymentMode: chamber.telemedicinePaymentMode as TelemedicinePaymentMode,
  };
}

export function chamberSupports(chamber: ChamberRow, careMode: CareMode): boolean {
  return careMode === 'PHYSICAL'
    ? chamber.supportsPhysical
    : careMode === 'REMOTE'
      ? chamber.supportsRemote
      : chamber.supportsHybrid;
}

/**
 * Chambers (API §3.5, DATABASE §3.5): a doctor-facing service location inside a clinic with its default
 * queue policy and payment modes. Every write appends an audit row and an outbox event in one transaction.
 */
export class ChamberService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: PrismaAuditPort,
    private readonly events: SchedulingEvents,
    private readonly clock: Clock = systemClock,
  ) {}

  private async view(c: ChamberRow, doctorName?: string): Promise<ChamberView> {
    const name =
      doctorName ??
      (
        await this.prisma.doctorProfile.findFirst({
          where: { tenantId: c.tenantId, id: c.doctorProfileId },
          select: { displayName: true },
        })
      )?.displayName ??
      '';
    return {
      id: c.id,
      clinicId: c.clinicId,
      doctorProfileId: c.doctorProfileId,
      doctorDisplayName: name,
      name: c.name,
      supportsPhysical: c.supportsPhysical,
      supportsRemote: c.supportsRemote,
      supportsHybrid: c.supportsHybrid,
      defaultQueuePolicy: resolveQueuePolicy(c.defaultQueuePolicy),
      status: c.status as ChamberView['status'],
      chamberPaymentMode: c.chamberPaymentMode as ChamberPaymentMode,
      telemedicinePaymentMode: c.telemedicinePaymentMode as TelemedicinePaymentMode,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      rowVersion: c.rowVersion,
    };
  }

  private validatePolicy(patch: QueuePolicyPatch | undefined): QueuePolicy {
    const policy = resolveQueuePolicy(patch ?? {});
    const problems = policyProblems(policy);
    if (problems.length) {
      throw validation(
        problems.map((p) => ({
          path: `defaultQueuePolicy.${p.path}`,
          code: p.code,
          message: `validation.policy.${p.code}`,
        })),
      );
    }
    return policy;
  }

  /** Chamber row in the tenant, or RESOURCE_NOT_FOUND (never reveals other tenants' chambers). */
  async require(tenantId: string, chamberId: string, tx?: Tx): Promise<ChamberRow> {
    const c = await (tx ?? this.prisma).chamber.findFirst({
      where: { tenantId, id: chamberId, deletedAt: null },
    });
    if (!c) throw new AppError('RESOURCE_NOT_FOUND');
    return c;
  }

  async create(actor: SchedulingActor, input: CreateChamberInput): Promise<ChamberView> {
    const tenantId = actor.tenant.tenantId;
    assertClinicScope(actor, input.clinicId);
    const errors: FieldError[] = [];
    if (!input.supportsPhysical && !input.supportsRemote && !input.supportsHybrid)
      errors.push({ path: 'supportsPhysical', code: 'no_care_mode', message: 'validation.no_care_mode' });
    const clinic = await this.prisma.clinic.findFirst({
      where: { tenantId, id: input.clinicId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    if (!clinic)
      errors.push({ path: 'clinicId', code: 'unknown_clinic', message: 'validation.unknown_clinic' });
    const doctor = await this.prisma.doctorProfile.findFirst({
      where: { tenantId, id: input.doctorProfileId, status: 'ACTIVE' },
      select: { id: true, displayName: true },
    });
    if (!doctor)
      errors.push({ path: 'doctorProfileId', code: 'unknown_doctor', message: 'validation.unknown_doctor' });
    if (errors.length) throw validation(errors);
    const policy = this.validatePolicy(input.defaultQueuePolicy);
    const now = this.clock.now();
    const id = newId();
    const row = await withTransaction(this.prisma, async (tx) => {
      const c = await tx.chamber.create({
        data: {
          id,
          tenantId,
          clinicId: input.clinicId,
          doctorProfileId: input.doctorProfileId,
          name: input.name.trim(),
          supportsPhysical: input.supportsPhysical,
          supportsRemote: input.supportsRemote,
          supportsHybrid: input.supportsHybrid,
          defaultQueuePolicy: policy as never,
          status: 'ACTIVE',
          chamberPaymentMode: input.chamberPaymentMode ?? 'PAY_AT_CHAMBER',
          telemedicinePaymentMode: input.telemedicinePaymentMode ?? 'PREPAID_REQUIRED',
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
        action: 'CHAMBER_CREATED',
        resourceType: 'chamber',
        resourceId: id,
        outcome: 'SUCCESS',
        requestId: actor.requestId ?? null,
        correlationId: actor.correlationId ?? null,
        metadata: { clinicId: input.clinicId, doctorProfileId: input.doctorProfileId },
      });
      await this.events.emit(tx, {
        tenantId,
        name: 'ChamberCreated',
        aggregateType: 'chamber',
        aggregateId: id,
        payload: { chamberId: id, clinicId: input.clinicId, doctorProfileId: input.doctorProfileId },
        actorId: actor.userId,
        correlationId: actor.correlationId ?? null,
      });
      return c;
    });
    return this.view(row, doctor!.displayName);
  }

  async update(actor: SchedulingActor, chamberId: string, input: UpdateChamberInput): Promise<ChamberView> {
    const tenantId = actor.tenant.tenantId;
    const existing = await this.require(tenantId, chamberId);
    assertChamberScope(actor, existing);
    const modes = {
      supportsPhysical: input.supportsPhysical ?? existing.supportsPhysical,
      supportsRemote: input.supportsRemote ?? existing.supportsRemote,
      supportsHybrid: input.supportsHybrid ?? existing.supportsHybrid,
    };
    if (!modes.supportsPhysical && !modes.supportsRemote && !modes.supportsHybrid)
      throw validation([
        { path: 'supportsPhysical', code: 'no_care_mode', message: 'validation.no_care_mode' },
      ]);
    const policy =
      input.defaultQueuePolicy === undefined
        ? undefined
        : this.validatePolicy({
            ...resolveQueuePolicy(existing.defaultQueuePolicy),
            ...input.defaultQueuePolicy,
          });
    const now = this.clock.now();
    const row = await withTransaction(this.prisma, async (tx) => {
      await lockRow(tx, 'chambers', chamberId, tenantId);
      const current = await tx.chamber.findFirstOrThrow({ where: { tenantId, id: chamberId } });
      if (current.rowVersion !== input.expectedRowVersion) {
        throw new AppError('STALE_VERSION', undefined, {
          details: { currentRowVersion: current.rowVersion },
        });
      }
      const changed = Object.keys(input).filter((k) => k !== 'expectedRowVersion');
      const c = await tx.chamber.update({
        where: { id: chamberId },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...modes,
          ...(policy ? { defaultQueuePolicy: policy as never } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.chamberPaymentMode !== undefined ? { chamberPaymentMode: input.chamberPaymentMode } : {}),
          ...(input.telemedicinePaymentMode !== undefined
            ? { telemedicinePaymentMode: input.telemedicinePaymentMode }
            : {}),
          updatedAt: now,
          updatedByUserId: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.audit.append(tx, {
        tenantId,
        actorUserId: actor.userId,
        actorType: 'USER',
        action: 'CHAMBER_UPDATED',
        resourceType: 'chamber',
        resourceId: chamberId,
        outcome: 'SUCCESS',
        requestId: actor.requestId ?? null,
        correlationId: actor.correlationId ?? null,
        metadata: { changed: changed.join(',') },
      });
      await this.events.emit(tx, {
        tenantId,
        name: 'ChamberUpdated',
        aggregateType: 'chamber',
        aggregateId: chamberId,
        payload: { chamberId, changed },
        actorId: actor.userId,
        correlationId: actor.correlationId ?? null,
      });
      return c;
    });
    return this.view(row);
  }

  async get(actor: SchedulingActor, chamberId: string): Promise<ChamberView> {
    const c = await this.require(actor.tenant.tenantId, chamberId);
    assertChamberScope(actor, c);
    return this.view(c);
  }

  /** Public chamber facts for a patient context (no scope restriction beyond the tenant). */
  async getPublic(tenantId: string, chamberId: string): Promise<ChamberView> {
    return this.view(await this.require(tenantId, chamberId));
  }

  /** Public chamber list for a patient context: tenant-scoped, ACTIVE only, no membership scope. */
  async listPublic(
    tenantId: string,
    filter: { clinicId?: string; doctorProfileId?: string } = {},
  ): Promise<ChamberView[]> {
    const rows = await this.prisma.chamber.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: 'ACTIVE',
        ...(filter.clinicId ? { clinicId: filter.clinicId } : {}),
        ...(filter.doctorProfileId ? { doctorProfileId: filter.doctorProfileId } : {}),
      },
      orderBy: [{ clinicId: 'asc' }, { name: 'asc' }],
      take: 200,
    });
    return Promise.all(rows.map((r) => this.view(r)));
  }

  async list(
    actor: SchedulingActor,
    filter: { clinicId?: string; doctorProfileId?: string; status?: 'ACTIVE' | 'INACTIVE' },
  ): Promise<ChamberView[]> {
    const tenantId = actor.tenant.tenantId;
    const rows = await this.prisma.chamber.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(filter.clinicId ? { clinicId: filter.clinicId } : {}),
        ...(filter.doctorProfileId ? { doctorProfileId: filter.doctorProfileId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(actor.tenant.clinicIds.length ? { clinicId: { in: [...actor.tenant.clinicIds] } } : {}),
        ...(actor.tenant.chamberIds.length ? { id: { in: [...actor.tenant.chamberIds] } } : {}),
      },
      orderBy: [{ clinicId: 'asc' }, { name: 'asc' }],
      take: 200,
    });
    const doctors = new Map(
      (
        await this.prisma.doctorProfile.findMany({
          where: { tenantId, id: { in: [...new Set(rows.map((r) => r.doctorProfileId))] } },
          select: { id: true, displayName: true },
        })
      ).map((d) => [d.id, d.displayName]),
    );
    return Promise.all(rows.map((r) => this.view(r, doctors.get(r.doctorProfileId) ?? '')));
  }
}
