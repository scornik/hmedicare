import { createHash } from 'node:crypto';
import {
  AppError,
  type Clock,
  type FieldError,
  type TenantContext,
  newId,
  systemClock,
} from '@hmedic/kernel';
import { type PrismaClient, isUniqueViolation, lockRow, withTransaction } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';

export interface ClinicView {
  id: string;
  name: string;
  smsDisplayName: string | null;
  address: Record<string, string> | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

export interface ClinicActor {
  userId: string;
  tenant: TenantContext;
  requestId?: string;
}

export interface CreateClinicInput {
  name: string;
  smsDisplayName?: string | null;
  address?: Record<string, string> | null;
}

export interface UpdateClinicInput {
  expectedRowVersion: number;
  name?: string;
  smsDisplayName?: string | null;
  address?: Record<string, string> | null;
  status?: 'ACTIVE' | 'INACTIVE';
}

type ClinicRow = Awaited<ReturnType<PrismaClient['clinic']['findFirstOrThrow']>>;

const validation = (fieldErrors: FieldError[]) =>
  new AppError('VALIDATION_FAILED', undefined, { fieldErrors });
const nameHash = (name: string) =>
  createHash('sha256').update(name.trim().toLowerCase().replace(/\s+/g, ' ')).digest('hex');

function view(c: ClinicRow): ClinicView {
  return {
    id: c.id,
    name: c.name,
    smsDisplayName: c.smsDisplayName,
    address: (c.address as Record<string, string> | null) ?? null,
    status: c.status as ClinicView['status'],
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    rowVersion: c.rowVersion,
  };
}

/**
 * Clinics (API §3.3 `clinic.manage`, DATABASE §3.2): locations of a tenant. Active names are unique per
 * tenant (`uq_clinics_active_name`). A clinic-scoped membership may manage only its own clinics.
 */
export class ClinicService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: PrismaAuditPort,
    private readonly clock: Clock = systemClock,
  ) {}

  private scope(actor: ClinicActor, clinicId: string): void {
    const ids = actor.tenant.clinicIds;
    if (ids.length > 0 && !ids.includes(clinicId)) throw new AppError('FORBIDDEN');
  }

  async create(actor: ClinicActor, input: CreateClinicInput): Promise<ClinicView> {
    const tenantId = actor.tenant.tenantId;
    const name = input.name.trim();
    if (name.length < 2)
      throw validation([{ path: 'name', code: 'too_short', message: 'validation.too_short' }]);
    const now = this.clock.now();
    const id = newId();
    try {
      const row = await withTransaction(this.prisma, async (tx) => {
        const c = await tx.clinic.create({
          data: {
            id,
            tenantId,
            name,
            nameNormalizedHash: nameHash(name),
            smsDisplayName: input.smsDisplayName?.trim() || null,
            address: (input.address as never) ?? null,
            status: 'ACTIVE',
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
          action: 'CLINIC_CREATED',
          resourceType: 'clinic',
          resourceId: id,
          outcome: 'SUCCESS',
          requestId: actor.requestId ?? null,
          metadata: {},
        });
        return c;
      });
      return view(row);
    } catch (error) {
      if (isUniqueViolation(error, 'uq_clinics_active_name'))
        throw validation([{ path: 'name', code: 'duplicate_name', message: 'validation.duplicate_name' }]);
      throw error;
    }
  }

  async update(actor: ClinicActor, clinicId: string, input: UpdateClinicInput): Promise<ClinicView> {
    const tenantId = actor.tenant.tenantId;
    this.scope(actor, clinicId);
    const now = this.clock.now();
    try {
      const row = await withTransaction(this.prisma, async (tx) => {
        const existing = await tx.clinic.findFirst({ where: { tenantId, id: clinicId, deletedAt: null } });
        if (!existing) throw new AppError('RESOURCE_NOT_FOUND');
        await lockRow(tx, 'clinics', clinicId, tenantId);
        if (existing.rowVersion !== input.expectedRowVersion)
          throw new AppError('STALE_VERSION', undefined, {
            details: { currentRowVersion: existing.rowVersion },
          });
        const name = input.name?.trim();
        const c = await tx.clinic.update({
          where: { id: clinicId },
          data: {
            ...(name ? { name, nameNormalizedHash: nameHash(name) } : {}),
            ...(input.smsDisplayName !== undefined
              ? { smsDisplayName: input.smsDisplayName?.trim() || null }
              : {}),
            ...(input.address !== undefined ? { address: (input.address as never) ?? null } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            updatedAt: now,
            updatedByUserId: actor.userId,
            rowVersion: { increment: 1 },
          },
        });
        await this.audit.append(tx, {
          tenantId,
          actorUserId: actor.userId,
          actorType: 'USER',
          action: 'CLINIC_UPDATED',
          resourceType: 'clinic',
          resourceId: clinicId,
          outcome: 'SUCCESS',
          requestId: actor.requestId ?? null,
          metadata: { changed: Object.keys(input).filter((k) => k !== 'expectedRowVersion') },
        });
        return c;
      });
      return view(row);
    } catch (error) {
      if (isUniqueViolation(error, 'uq_clinics_active_name'))
        throw validation([{ path: 'name', code: 'duplicate_name', message: 'validation.duplicate_name' }]);
      throw error;
    }
  }

  async list(actor: ClinicActor): Promise<ClinicView[]> {
    const rows = await this.prisma.clinic.findMany({
      where: {
        tenantId: actor.tenant.tenantId,
        deletedAt: null,
        ...(actor.tenant.clinicIds.length ? { id: { in: [...actor.tenant.clinicIds] } } : {}),
      },
      orderBy: { name: 'asc' },
      take: 200,
    });
    return rows.map(view);
  }

  async get(actor: ClinicActor, clinicId: string): Promise<ClinicView> {
    this.scope(actor, clinicId);
    const c = await this.prisma.clinic.findFirst({
      where: { tenantId: actor.tenant.tenantId, id: clinicId, deletedAt: null },
    });
    if (!c) throw new AppError('RESOURCE_NOT_FOUND');
    return view(c);
  }
}
