import { createHash } from 'node:crypto';
import { AppError, type Clock, type FieldError, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, type Tx, isUniqueViolation, lockRow, withTransaction } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import { maskPhone, nameSearchTokens, normalizeBdMobile } from '@hmedic/localization';
import {
  type DuplicateCandidate,
  type DuplicateProbe,
  rankDuplicates,
  requiresReview,
} from '../domain/duplicates';
import { mrnFromId, normalizeMrn } from '../domain/mrn';
import type { PatientActor, PatientContextActor, PatientFacts, PatientReadPort } from '../application/ports';
import type { PatientEvents } from './events';

export interface ContactView {
  id: string;
  type: 'PHONE' | 'EMAIL' | 'WHATSAPP';
  displayValue: string;
  verificationStatus: string;
  isPreferred: boolean;
  relationship: string;
  status: string;
  rowVersion: number;
}

export interface PatientView {
  id: string;
  medicalRecordNumber: string;
  legalName: string;
  legalNameBn: string | null;
  displayName: string;
  dateOfBirth: string | null;
  birthYear: number | null;
  sex: string | null;
  genderIdentity: string | null;
  address: Record<string, string> | null;
  preferredLocale: string | null;
  status: string;
  mergedIntoPatientId: string | null;
  contacts: ContactView[];
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

export interface PatientSummaryView {
  id: string;
  medicalRecordNumber: string;
  displayName: string;
  legalName: string;
  legalNameBn: string | null;
  sex: string | null;
  birthYear: number | null;
  phoneMasked: string | null;
  status: string;
}

export interface ContactInput {
  type: 'PHONE' | 'EMAIL' | 'WHATSAPP';
  value: string;
  relationship: 'SELF' | 'CAREGIVER' | 'EMERGENCY';
  isPreferred: boolean;
}

export interface DemographicsInput {
  legalName: string;
  legalNameBn?: string | null;
  displayName?: string;
  dateOfBirth?: string | null;
  birthYear?: number | null;
  sex?: string;
  genderIdentity?: string;
  address?: Record<string, string> | null;
  preferredLocale?: string;
}

export interface CreatePatientInput extends DemographicsInput {
  contacts: ContactInput[];
  consents: string[];
  duplicateReview?: { acknowledgedCandidateIds: string[]; reason: string };
}

export interface UpdatePatientInput extends Partial<DemographicsInput> {
  expectedRowVersion: number;
  addContacts?: ContactInput[];
  removeContactIds?: string[];
}

export interface SearchInput {
  query?: string;
  phone?: string;
  mrn?: string;
  cursor?: string;
  limit?: number;
}

export interface SearchResult {
  items: PatientSummaryView[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface DuplicateCheckInput {
  legalName: string;
  legalNameBn?: string | null;
  phones: string[];
  dateOfBirth?: string | null;
  birthYear?: number | null;
  excludePatientId?: string;
}

export interface DuplicateCheckResult {
  candidates: Array<{ patient: PatientSummaryView; score: number; reasons: DuplicateCandidate['reasons'] }>;
  reviewRequired: boolean;
}

const SEARCH_CANDIDATE_CAP = 500;
const DEFAULT_LIMIT = 20;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const localDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const dateValue = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00.000Z`) : null);

function validation(fieldErrors: FieldError[]): AppError {
  return new AppError('VALIDATION_FAILED', undefined, { fieldErrors });
}

/** Normalizes one contact; invalid phones/emails are field errors. */
export function normalizeContact(c: ContactInput, index: number): { normalized: string; display: string } {
  if (c.type === 'EMAIL') {
    const v = c.value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || v.length > 254) {
      throw validation([
        { path: `contacts.${index}.value`, code: 'invalid_email', message: 'validation.invalid_email' },
      ]);
    }
    return { normalized: v, display: v };
  }
  const e164 = normalizeBdMobile(c.value);
  if (!e164) {
    throw validation([
      { path: `contacts.${index}.value`, code: 'invalid_phone', message: 'validation.invalid_phone' },
    ]);
  }
  return { normalized: e164, display: c.value.trim() };
}

type PatientRow = Awaited<ReturnType<PrismaClient['patient']['findFirstOrThrow']>>;

/**
 * Patient registry (DOMAIN-SERVICE-CONTRACTS §1, API §3.4, audit C-41/C-47). Tenant-scoped in every query;
 * duplicate detection never merges; search runs on the derived token index and is bounded and paginated;
 * every write appends an audit row and an outbox event in the same transaction.
 */
export class PatientService implements PatientReadPort {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: PrismaAuditPort,
    private readonly events: PatientEvents,
    private readonly clock: Clock = systemClock,
  ) {}

  // ---------------------------------------------------------------- views

  private contactView(c: {
    id: string;
    type: string;
    displayValue: string;
    verificationStatus: string;
    isPreferred: boolean;
    relationship: string;
    status: string;
    rowVersion: number;
  }): ContactView {
    return {
      id: c.id,
      type: c.type as ContactView['type'],
      displayValue: c.displayValue,
      verificationStatus: c.verificationStatus,
      isPreferred: c.isPreferred,
      relationship: c.relationship,
      status: c.status,
      rowVersion: c.rowVersion,
    };
  }

  private view(p: PatientRow, contacts: Parameters<PatientService['contactView']>[0][]): PatientView {
    return {
      id: p.id,
      medicalRecordNumber: p.medicalRecordNumber,
      legalName: p.legalName,
      legalNameBn: p.legalNameBn,
      displayName: p.displayName,
      dateOfBirth: localDate(p.dateOfBirth),
      birthYear: p.birthYear,
      sex: p.sex,
      genderIdentity: p.genderIdentity,
      address: (p.address as Record<string, string> | null) ?? null,
      preferredLocale: p.preferredLocale,
      status: p.status,
      mergedIntoPatientId: p.mergedIntoPatientId,
      contacts: contacts.filter((c) => c.status === 'ACTIVE').map((c) => this.contactView(c)),
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      rowVersion: p.rowVersion,
    };
  }

  private async summaries(tenantId: string, rows: PatientRow[]): Promise<PatientSummaryView[]> {
    if (rows.length === 0) return [];
    const phones = await this.prisma.patientContact.findMany({
      where: { tenantId, patientId: { in: rows.map((r) => r.id) }, type: 'PHONE', status: 'ACTIVE' },
      orderBy: [{ isPreferred: 'desc' }, { createdAt: 'asc' }],
      select: { patientId: true, normalizedValue: true },
    });
    const first = new Map<string, string>();
    for (const c of phones) if (!first.has(c.patientId)) first.set(c.patientId, c.normalizedValue);
    return rows.map((p) => ({
      id: p.id,
      medicalRecordNumber: p.medicalRecordNumber,
      displayName: p.displayName,
      legalName: p.legalName,
      legalNameBn: p.legalNameBn,
      sex: p.sex,
      birthYear: p.birthYear ?? (p.dateOfBirth ? p.dateOfBirth.getUTCFullYear() : null),
      phoneMasked: first.has(p.id) ? maskPhone(first.get(p.id)!) : null,
      status: p.status,
    }));
  }

  // ---------------------------------------------------------------- read port

  async resolveActive(tenantId: string, patientId: string): Promise<PatientFacts | null> {
    let p = await this.prisma.patient.findFirst({ where: { tenantId, id: patientId } });
    // One hop: merges are never chained (the target of an approved merge is always ACTIVE at merge time).
    if (p?.status === 'MERGED' && p.mergedIntoPatientId) {
      p = await this.prisma.patient.findFirst({ where: { tenantId, id: p.mergedIntoPatientId } });
    }
    if (!p) return null;
    return {
      id: p.id,
      tenantId: p.tenantId,
      status: p.status as PatientFacts['status'],
      mergedIntoPatientId: p.mergedIntoPatientId,
      displayName: p.displayName,
      medicalRecordNumber: p.medicalRecordNumber,
    };
  }

  async factsByIds(tenantId: string, patientIds: readonly string[]): Promise<Map<string, PatientFacts>> {
    const rows = await this.prisma.patient.findMany({ where: { tenantId, id: { in: [...patientIds] } } });
    return new Map(
      rows.map((p) => [
        p.id,
        {
          id: p.id,
          tenantId: p.tenantId,
          status: p.status as PatientFacts['status'],
          mergedIntoPatientId: p.mergedIntoPatientId,
          displayName: p.displayName,
          medicalRecordNumber: p.medicalRecordNumber,
        },
      ]),
    );
  }

  // ---------------------------------------------------------------- search tokens

  private async rebuildTokens(
    tx: Tx,
    tenantId: string,
    patientId: string,
    legalName: string,
    legalNameBn: string | null,
  ) {
    const tokens = nameSearchTokens(legalName, legalNameBn);
    await tx.patientSearchToken.deleteMany({ where: { tenantId, patientId } });
    const now = this.clock.now();
    const rows = [
      ...tokens.names.map((token) => ({ tokenKind: 'NAME', token })),
      ...tokens.skeletons.map((token) => ({ tokenKind: 'SKELETON', token })),
    ];
    if (rows.length) {
      await tx.patientSearchToken.createMany({
        data: rows.map((r) => ({
          id: newId(),
          tenantId,
          patientId,
          tokenKind: r.tokenKind,
          token: r.token,
          translitVersion: tokens.version,
          createdAt: now,
        })),
      });
    }
  }

  // ---------------------------------------------------------------- duplicates

  private async candidateProbes(
    tenantId: string,
    probe: DuplicateProbe,
    exclude?: string,
  ): Promise<Array<DuplicateProbe & { patientId: string }>> {
    const ids = new Set<string>();
    if (probe.phones.length) {
      const byPhone = await this.prisma.patientContact.findMany({
        where: {
          tenantId,
          type: 'PHONE',
          status: 'ACTIVE',
          normalizedValueHash: { in: probe.phones.map(sha256) },
        },
        select: { patientId: true },
        take: 200,
      });
      for (const c of byPhone) ids.add(c.patientId);
    }
    const tokens = nameSearchTokens(probe.legalName, probe.legalNameBn);
    if (tokens.skeletons.length) {
      const byName = await this.prisma.patientSearchToken.findMany({
        where: { tenantId, tokenKind: 'SKELETON', token: { in: tokens.skeletons } },
        select: { patientId: true },
        take: SEARCH_CANDIDATE_CAP,
      });
      for (const t of byName) ids.add(t.patientId);
    }
    if (exclude) ids.delete(exclude);
    if (ids.size === 0) return [];
    const patients = await this.prisma.patient.findMany({
      where: { tenantId, id: { in: [...ids] }, status: 'ACTIVE' },
    });
    const contacts = await this.prisma.patientContact.findMany({
      where: { tenantId, patientId: { in: patients.map((p) => p.id) }, type: 'PHONE', status: 'ACTIVE' },
      select: { patientId: true, normalizedValue: true },
    });
    const phonesOf = new Map<string, string[]>();
    for (const c of contacts)
      phonesOf.set(c.patientId, [...(phonesOf.get(c.patientId) ?? []), c.normalizedValue]);
    return patients.map((p) => ({
      patientId: p.id,
      legalName: p.legalName,
      legalNameBn: p.legalNameBn,
      phones: phonesOf.get(p.id) ?? [],
      dateOfBirth: localDate(p.dateOfBirth),
      birthYear: p.birthYear,
    }));
  }

  private async rankCandidates(
    tenantId: string,
    probe: DuplicateProbe,
    exclude?: string,
  ): Promise<DuplicateCandidate[]> {
    return rankDuplicates(probe, await this.candidateProbes(tenantId, probe, exclude));
  }

  private probeOf(input: DuplicateCheckInput): DuplicateProbe {
    const phones: string[] = [];
    input.phones.forEach((raw, i) => {
      const e164 = normalizeBdMobile(raw);
      if (!e164)
        throw validation([
          { path: `phones.${i}`, code: 'invalid_phone', message: 'validation.invalid_phone' },
        ]);
      phones.push(e164);
    });
    return {
      legalName: input.legalName,
      legalNameBn: input.legalNameBn ?? null,
      phones,
      dateOfBirth: input.dateOfBirth ?? null,
      birthYear: input.birthYear ?? null,
    };
  }

  /** `POST /patients/duplicate-check` (C-43): candidates and scores, no side effects. */
  async duplicateCheck(actor: PatientActor, input: DuplicateCheckInput): Promise<DuplicateCheckResult> {
    const tenantId = actor.tenant.tenantId;
    const ranked = await this.rankCandidates(tenantId, this.probeOf(input), input.excludePatientId);
    const rows = await this.prisma.patient.findMany({
      where: { tenantId, id: { in: ranked.map((r) => r.patientId) } },
    });
    const byId = new Map((await this.summaries(tenantId, rows)).map((s) => [s.id, s]));
    return {
      candidates: ranked
        .filter((r) => byId.has(r.patientId))
        .map((r) => ({ patient: byId.get(r.patientId)!, score: r.score, reasons: r.reasons })),
      reviewRequired: requiresReview(ranked),
    };
  }

  // ---------------------------------------------------------------- create

  async create(actor: PatientActor, input: CreatePatientInput): Promise<PatientView> {
    const tenantId = actor.tenant.tenantId;
    const contacts = input.contacts.map((c, i) => ({ ...c, ...normalizeContact(c, i) }));
    if (input.dateOfBirth && input.birthYear && Number(input.dateOfBirth.slice(0, 4)) !== input.birthYear) {
      throw validation([{ path: 'birthYear', code: 'dob_mismatch', message: 'validation.dob_mismatch' }]);
    }
    const probe: DuplicateProbe = {
      legalName: input.legalName,
      legalNameBn: input.legalNameBn ?? null,
      phones: contacts.filter((c) => c.type === 'PHONE').map((c) => c.normalized),
      dateOfBirth: input.dateOfBirth ?? null,
      birthYear: input.birthYear ?? null,
    };
    const ranked = await this.rankCandidates(tenantId, probe);
    const review = ranked.filter((r) => r.score >= 0.65).map((r) => r.patientId);
    const acknowledged = new Set(input.duplicateReview?.acknowledgedCandidateIds ?? []);
    if (review.length && !review.every((id) => acknowledged.has(id))) {
      throw new AppError('DUPLICATE_PATIENT_REVIEW_REQUIRED', undefined, {
        details: { candidateIds: review.join(','), reviewRequired: true },
      });
    }

    const now = this.clock.now();
    const id = newId();
    const preferredIdx = contacts.findIndex((c) => c.isPreferred);
    return withTransaction(this.prisma, async (tx) => {
      const p = await tx.patient.create({
        data: {
          id,
          tenantId,
          medicalRecordNumber: mrnFromId(id),
          legalName: input.legalName,
          legalNameBn: input.legalNameBn ?? null,
          displayName: input.displayName ?? input.legalName,
          dateOfBirth: dateValue(input.dateOfBirth),
          birthYear: input.birthYear ?? (input.dateOfBirth ? Number(input.dateOfBirth.slice(0, 4)) : null),
          sex: input.sex ?? null,
          genderIdentity: input.genderIdentity ?? null,
          address: (input.address as never) ?? null,
          preferredLocale: input.preferredLocale ?? null,
          status: 'ACTIVE',
          createdAt: now,
          updatedAt: now,
          createdByUserId: actor.userId,
          updatedByUserId: actor.userId,
          rowVersion: 1,
        },
      });
      const contactRows = await Promise.all(
        contacts.map((c, i) =>
          tx.patientContact.create({
            data: {
              id: newId(),
              tenantId,
              patientId: id,
              type: c.type,
              normalizedValue: c.normalized,
              normalizedValueHash: sha256(c.normalized),
              displayValue: c.display,
              verificationStatus: 'UNVERIFIED',
              isPreferred: preferredIdx === -1 ? i === 0 : c.isPreferred,
              status: 'ACTIVE',
              relationship: c.relationship,
              createdAt: now,
              updatedAt: now,
              createdByUserId: actor.userId,
              updatedByUserId: actor.userId,
            },
          }),
        ),
      );
      for (const purpose of new Set(input.consents)) {
        await tx.patientConsent.create({
          data: {
            id: newId(),
            tenantId,
            patientId: id,
            purpose,
            status: 'GRANTED',
            policyVersion: 1,
            givenByUserId: actor.userId,
            givenByRelationship: 'STAFF_RECORDED',
            capturedAt: now,
            createdAt: now,
            updatedAt: now,
            createdByUserId: actor.userId,
            updatedByUserId: actor.userId,
          },
        });
      }
      await this.rebuildTokens(tx, tenantId, id, input.legalName, input.legalNameBn ?? null);
      await this.audit.append(tx, {
        tenantId,
        actorUserId: actor.userId,
        actorType: 'USER',
        action: 'PATIENT_CREATED',
        resourceType: 'patient',
        resourceId: id,
        outcome: 'SUCCESS',
        requestId: actor.requestId ?? null,
        correlationId: actor.correlationId ?? null,
        rolePermissionsVersion: actor.tenant.rolePermissionsVersion,
        metadata: {
          contactCount: contacts.length,
          consentCount: new Set(input.consents).size,
          duplicateCandidateCount: ranked.length,
        },
      });
      if (input.duplicateReview) {
        await this.audit.append(tx, {
          tenantId,
          actorUserId: actor.userId,
          actorType: 'USER',
          action: 'PATIENT_DUPLICATE_OVERRIDE',
          resourceType: 'patient',
          resourceId: id,
          outcome: 'SUCCESS',
          requestId: actor.requestId ?? null,
          rolePermissionsVersion: actor.tenant.rolePermissionsVersion,
          metadata: {
            acknowledgedCandidateIds: input.duplicateReview.acknowledgedCandidateIds,
            reason: input.duplicateReview.reason,
            topScore: ranked[0]?.score ?? 0,
          },
        });
      }
      await this.events.emit(tx, {
        tenantId,
        name: 'PatientCreated',
        aggregateType: 'patient',
        aggregateId: id,
        actorId: actor.userId,
        correlationId: actor.correlationId,
        payload: { patientId: id, duplicateReviewed: input.duplicateReview !== undefined },
      });
      return this.view(p, contactRows);
    });
  }

  // ---------------------------------------------------------------- read

  private async requireRow(tenantId: string, patientId: string): Promise<PatientRow> {
    const p = await this.prisma.patient.findFirst({ where: { tenantId, id: patientId } });
    if (!p) throw new AppError('RESOURCE_NOT_FOUND');
    return p;
  }

  /** Staff read (`patient.read`). A MERGED patient resolves to its target (C-47). */
  async get(actor: PatientActor, patientId: string): Promise<PatientView> {
    const tenantId = actor.tenant.tenantId;
    let p = await this.requireRow(tenantId, patientId);
    if (p.status === 'MERGED' && p.mergedIntoPatientId)
      p = await this.requireRow(tenantId, p.mergedIntoPatientId);
    const contacts = await this.prisma.patientContact.findMany({ where: { tenantId, patientId: p.id } });
    return this.view(p, contacts);
  }

  /** Patient-context read: only the context's own patient (the resolver already proved the link). */
  async getForContext(ctx: PatientContextActor, patientId: string): Promise<PatientView> {
    if (ctx.patientId !== patientId) throw new AppError('FORBIDDEN');
    const p = await this.requireRow(ctx.tenantId, patientId);
    const contacts = await this.prisma.patientContact.findMany({
      where: { tenantId: ctx.tenantId, patientId: p.id },
    });
    return this.view(p, contacts);
  }

  // ---------------------------------------------------------------- search

  async search(actor: PatientActor, input: SearchInput): Promise<SearchResult> {
    const tenantId = actor.tenant.tenantId;
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), 100);
    let ordered: string[] = [];
    let by: 'mrn' | 'phone' | 'query' | 'none' = 'none';

    if (input.mrn) {
      by = 'mrn';
      const mrn = normalizeMrn(input.mrn);
      if (mrn) {
        const p = await this.prisma.patient.findFirst({
          where: { tenantId, medicalRecordNumber: mrn, status: { not: 'MERGED' } },
          select: { id: true },
        });
        if (p) ordered = [p.id];
      }
    } else if (input.phone) {
      by = 'phone';
      const e164 = normalizeBdMobile(input.phone);
      if (!e164)
        throw validation([{ path: 'phone', code: 'invalid_phone', message: 'validation.invalid_phone' }]);
      const rows = await this.prisma.patientContact.findMany({
        where: { tenantId, type: 'PHONE', status: 'ACTIVE', normalizedValueHash: sha256(e164) },
        select: { patientId: true },
        orderBy: { patientId: 'asc' },
        take: SEARCH_CANDIDATE_CAP,
      });
      ordered = [...new Set(rows.map((r) => r.patientId))];
    } else if (input.query) {
      by = 'query';
      const tokens = nameSearchTokens(input.query);
      if (tokens.names.length === 0) {
        throw validation([{ path: 'query', code: 'too_short', message: 'validation.too_short' }]);
      }
      // Prefix match on NAME tokens plus exact SKELETON matches; ranked by the number of matched terms.
      const hits = await this.prisma.patientSearchToken.findMany({
        where: {
          tenantId,
          OR: [
            ...tokens.names.map((t) => ({ tokenKind: 'NAME', token: { startsWith: t } })),
            { tokenKind: 'SKELETON', token: { in: tokens.skeletons } },
          ],
        },
        select: { patientId: true, tokenKind: true, token: true },
        take: SEARCH_CANDIDATE_CAP * 4,
      });
      const score = new Map<string, number>();
      for (const h of hits) {
        const w = h.tokenKind === 'NAME' ? 2 : 1;
        score.set(h.patientId, (score.get(h.patientId) ?? 0) + w);
      }
      ordered = [...score.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, SEARCH_CANDIDATE_CAP)
        .map(([id]) => id);
    } else {
      throw validation([{ path: 'query', code: 'required', message: 'validation.required' }]);
    }

    // Keyset over the ranked id list: the cursor is the last id of the previous page.
    const start = input.cursor ? ordered.indexOf(input.cursor) + 1 : 0;
    const pageIds = ordered.slice(start, start + limit);
    const hasMore = start + limit < ordered.length;
    const rows = pageIds.length
      ? await this.prisma.patient.findMany({
          where: { tenantId, id: { in: pageIds }, status: { not: 'MERGED' } },
        })
      : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const items = await this.summaries(
      tenantId,
      pageIds.flatMap((id) => {
        const row = byId.get(id);
        return row ? [row] : [];
      }),
    );
    await withTransaction(this.prisma, (tx) =>
      this.audit.append(tx, {
        tenantId,
        actorUserId: actor.userId,
        actorType: 'USER',
        action: 'PATIENT_SEARCH',
        resourceType: 'patient',
        outcome: 'SUCCESS',
        requestId: actor.requestId ?? null,
        rolePermissionsVersion: actor.tenant.rolePermissionsVersion,
        metadata: { by, resultCount: items.length, page: start / limit },
      }),
    );
    return { items, nextCursor: hasMore ? (pageIds[pageIds.length - 1] ?? null) : null, hasMore };
  }

  // ---------------------------------------------------------------- update

  async update(actor: PatientActor, patientId: string, input: UpdatePatientInput): Promise<PatientView> {
    const tenantId = actor.tenant.tenantId;
    const adds = (input.addContacts ?? []).map((c, i) => ({ ...c, ...normalizeContact(c, i) }));
    const now = this.clock.now();
    return withTransaction(this.prisma, async (tx) => {
      if (!(await lockRow(tx, 'patients', patientId, tenantId))) throw new AppError('RESOURCE_NOT_FOUND');
      const p = await tx.patient.findUniqueOrThrow({ where: { id: patientId } });
      if (p.rowVersion !== input.expectedRowVersion) throw new AppError('STALE_VERSION');
      if (p.status === 'MERGED') throw new AppError('INVALID_TRANSITION', 'patient.merged');
      const legalName = input.legalName ?? p.legalName;
      const legalNameBn = input.legalNameBn === undefined ? p.legalNameBn : input.legalNameBn;
      const nameChanged = legalName !== p.legalName || legalNameBn !== p.legalNameBn;
      const updated = await tx.patient.update({
        where: { id: patientId },
        data: {
          legalName,
          legalNameBn,
          displayName: input.displayName ?? p.displayName,
          dateOfBirth: input.dateOfBirth === undefined ? p.dateOfBirth : dateValue(input.dateOfBirth),
          birthYear: input.birthYear === undefined ? p.birthYear : input.birthYear,
          sex: input.sex ?? p.sex,
          genderIdentity: input.genderIdentity ?? p.genderIdentity,
          address: input.address === undefined ? (p.address as never) : ((input.address as never) ?? null),
          preferredLocale: input.preferredLocale ?? p.preferredLocale,
          updatedAt: now,
          updatedByUserId: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      if (nameChanged) await this.rebuildTokens(tx, tenantId, patientId, legalName, legalNameBn);
      for (const c of adds) {
        try {
          await tx.patientContact.create({
            data: {
              id: newId(),
              tenantId,
              patientId,
              type: c.type,
              normalizedValue: c.normalized,
              normalizedValueHash: sha256(c.normalized),
              displayValue: c.display,
              verificationStatus: 'UNVERIFIED',
              isPreferred: c.isPreferred,
              status: 'ACTIVE',
              relationship: c.relationship,
              createdAt: now,
              updatedAt: now,
              createdByUserId: actor.userId,
              updatedByUserId: actor.userId,
            },
          });
        } catch (error) {
          if (isUniqueViolation(error, 'uq_patient_contacts_active')) {
            throw validation([
              { path: 'addContacts', code: 'duplicate_contact', message: 'validation.duplicate_contact' },
            ]);
          }
          throw error;
        }
      }
      if (input.removeContactIds?.length) {
        await tx.patientContact.updateMany({
          where: { tenantId, patientId, id: { in: input.removeContactIds }, status: 'ACTIVE' },
          data: {
            status: 'INACTIVE',
            updatedAt: now,
            updatedByUserId: actor.userId,
            rowVersion: { increment: 1 },
          },
        });
      }
      const changed = Object.keys(input).filter((k) => k !== 'expectedRowVersion');
      await this.audit.append(tx, {
        tenantId,
        actorUserId: actor.userId,
        actorType: 'USER',
        action: 'PATIENT_UPDATED',
        resourceType: 'patient',
        resourceId: patientId,
        outcome: 'SUCCESS',
        requestId: actor.requestId ?? null,
        rolePermissionsVersion: actor.tenant.rolePermissionsVersion,
        metadata: { fields: changed, nameChanged },
      });
      await this.events.emit(tx, {
        tenantId,
        name: 'PatientUpdated',
        aggregateType: 'patient',
        aggregateId: patientId,
        actorId: actor.userId,
        correlationId: actor.correlationId,
        payload: { patientId, fields: changed },
      });
      const contacts = await tx.patientContact.findMany({ where: { tenantId, patientId } });
      return this.view(updated, contacts);
    });
  }
}
