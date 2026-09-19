import type { PrismaClient } from '@hmedic/database';
import { dhakaDate } from '@hmedic/localization';
import { GUARDIAN_SCOPES, type PatientContextActor } from '../application/ports';

export interface PatientContextSummary {
  tenantId: string;
  tenantName: string;
  patientId: string;
  patientDisplayName: string;
  relationship: string;
  authorityScope: string[];
}

function scopes(value: unknown): Set<string> {
  const allowed = new Set<string>(GUARDIAN_SCOPES);
  return new Set(
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && allowed.has(v)) : [],
  );
}

/**
 * PatientContextResolver (AUTHORIZATION-MATRIX §4). Resolves `(user, tenant, X-Patient-Context)` into a
 * PatientContextActor: an ACTIVE patient account (SELF) or an ACTIVE guardianship whose window covers today
 * in the tenant time zone (GUARDIAN, with its authority scope). Never cached across requests; failures are
 * `null` (the guard answers FORBIDDEN without revealing whether the patient exists).
 */
export class PatientContextResolver {
  constructor(private readonly prisma: PrismaClient) {}

  async resolve(
    userId: string,
    tenantId: string,
    patientId: string,
    now: Date,
  ): Promise<Omit<PatientContextActor, 'requestId' | 'correlationId'> | null> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!tenant) return null;
    const patient = await this.prisma.patient.findFirst({
      where: { tenantId, id: patientId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!patient) return null;
    const self = await this.prisma.patientAccount.findFirst({
      where: { tenantId, userId, patientId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (self) {
      return {
        userId,
        tenantId,
        patientId,
        actingAs: 'SELF',
        guardianshipId: null,
        authorityScope: new Set(),
      };
    }
    const today = dhakaDate(now);
    const g = await this.prisma.patientGuardianship.findFirst({
      where: { tenantId, guardianUserId: userId, dependentPatientId: patientId, status: 'ACTIVE' },
    });
    if (!g) return null;
    const startsOn = g.startsOn.toISOString().slice(0, 10);
    const endsOn = g.endsOn?.toISOString().slice(0, 10) ?? null;
    if (startsOn > today || (endsOn !== null && endsOn < today)) return null;
    return {
      userId,
      tenantId,
      patientId,
      actingAs: 'GUARDIAN',
      guardianshipId: g.id,
      authorityScope: scopes(g.authorityScope),
    };
  }

  /** `GET /me/patient-contexts`: every active SELF account and active guardianship across tenants. */
  async listForUser(userId: string, now: Date): Promise<PatientContextSummary[]> {
    const today = dhakaDate(now);
    const [accounts, guardianships] = await Promise.all([
      this.prisma.patientAccount.findMany({ where: { userId, status: 'ACTIVE' } }),
      this.prisma.patientGuardianship.findMany({ where: { guardianUserId: userId, status: 'ACTIVE' } }),
    ]);
    const live = guardianships.filter((g) => {
      const s = g.startsOn.toISOString().slice(0, 10);
      const e = g.endsOn?.toISOString().slice(0, 10) ?? null;
      return s <= today && (e === null || e >= today);
    });
    const patientIds = [...accounts.map((a) => a.patientId), ...live.map((g) => g.dependentPatientId)];
    const tenantIds = [...new Set([...accounts.map((a) => a.tenantId), ...live.map((g) => g.tenantId)])];
    if (patientIds.length === 0) return [];
    const [patients, tenants] = await Promise.all([
      this.prisma.patient.findMany({
        where: { id: { in: patientIds }, status: 'ACTIVE' },
        select: { id: true, tenantId: true, displayName: true },
      }),
      this.prisma.tenant.findMany({
        where: { id: { in: tenantIds }, status: 'ACTIVE' },
        select: { id: true, name: true },
      }),
    ]);
    const tenantName = new Map(tenants.map((t) => [t.id, t.name]));
    const patient = new Map(patients.map((p) => [p.id, p]));
    const out: PatientContextSummary[] = [];
    for (const a of accounts) {
      const p = patient.get(a.patientId);
      if (!p || !tenantName.has(a.tenantId)) continue;
      out.push({
        tenantId: a.tenantId,
        tenantName: tenantName.get(a.tenantId)!,
        patientId: p.id,
        patientDisplayName: p.displayName,
        relationship: 'SELF',
        authorityScope: [...GUARDIAN_SCOPES],
      });
    }
    for (const g of live) {
      const p = patient.get(g.dependentPatientId);
      if (!p || !tenantName.has(g.tenantId)) continue;
      out.push({
        tenantId: g.tenantId,
        tenantName: tenantName.get(g.tenantId)!,
        patientId: p.id,
        patientDisplayName: p.displayName,
        relationship: g.relationship,
        authorityScope: [...scopes(g.authorityScope)],
      });
    }
    return out.sort(
      (x, y) =>
        x.tenantName.localeCompare(y.tenantName) || x.patientDisplayName.localeCompare(y.patientDisplayName),
    );
  }
}
