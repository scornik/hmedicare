import type { PrismaClient } from '@hmedic/database';

/**
 * Retrieval for AI jobs (AI-001, AI-IMPLEMENTATION §8).
 *
 * Builds the structured context a prompt will carry, from one patient's record, inside one tenant.
 * Three properties matter more than the queries.
 *
 * **The source table is authoritative.** `timeline_events` is used to find candidates quickly, but
 * every candidate is then loaded from the table that owns it, and a timeline entry whose source has
 * since been voided or corrected is dropped. If the two disagree, the source wins — a projection is a
 * convenience, and sending a model a summary the chart no longer agrees with would put a stale claim
 * in front of a doctor as though it were current.
 *
 * **A stale projection falls back to the source tables.** The timeline is written by a job, so it lags.
 * When the lag exceeds the configured bound, the same filters run directly against the source tables:
 * a doctor who finished a consultation thirty seconds ago must not get a draft that omits it.
 *
 * **Exclusions are refusals, not filters.** A redacted timeline entry excludes its original too, a
 * voided prescription or an entered-in-error diagnosis never appears, and a draft note other than this
 * encounter's is never read. Each of those is something a doctor deliberately took out of the record,
 * and putting it back into a prompt would undo that decision.
 *
 * Lab reports and results are named in §8 but have no tables in this schema yet, so they are not
 * retrieved. They join this list with the module that creates them.
 */
export const RETRIEVAL_DEFAULTS = {
  lookbackDays: 730,
  maxLookbackDays: 3650,
  maxItems: 20,
  maxItemsHardLimit: 50,
  maxItemsPerSourceType: 10,
  maxProjectionLagSeconds: 60,
} as const;

/** What the caller asked for. Values above a maximum are clamped, never refused. */
export interface RetrievalRequest {
  tenantId: string;
  patientId: string;
  /** The consultation this runs for. Its draft note is the only draft ever read. */
  encounterId: string;
  lookbackDays?: number;
  maxItems?: number;
  /** Draft sections the doctor selected. Nothing else from the draft is sent. */
  draftSections?: readonly ('chief_complaint' | 'history' | 'examination' | 'assessment' | 'plan')[];
}

export type RetrievalSourceType =
  | 'encounter'
  | 'encounter_note_version'
  | 'encounter_note_draft'
  | 'diagnosis'
  | 'prescription'
  | 'follow_up_plan';

export interface RetrievedItem {
  /** The id the prompt cites and the suggestion stores, stable within one job. */
  ref: string;
  sourceType: RetrievalSourceType;
  sourceId: string;
  occurredAt: Date;
  /** Clinical text, before minimization. Never leaves this process unminimized when policy requires it. */
  text: string;
}

/** Recorded on the draft, so a thin result is explainable afterwards (§8). */
export interface RetrievalEffective {
  lookbackDays: number;
  maxItems: number;
  maxItemsPerSourceType: number;
  /** True when the timeline was too far behind and the source tables were queried instead. */
  usedSourceFallback: boolean;
  projectionLagSeconds: number | null;
  /** Candidates dropped because a per-type or overall cap was reached. */
  droppedByCap: number;
  /** Candidates dropped because the owning row was voided, redacted or missing. */
  droppedByExclusion: number;
}

export interface RetrievalResult {
  items: RetrievedItem[];
  effective: RetrievalEffective;
}

const clamp = (value: number | undefined, fallback: number, max: number): number => {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
};

const NOTE_SECTIONS = ['chief_complaint', 'history', 'examination', 'assessment', 'plan'] as const;
type NoteSection = (typeof NOTE_SECTIONS)[number];

/** Section label plus text, skipping empty sections so an empty heading is never sent. */
function noteText(
  row: Partial<Record<NoteSection, string | null>>,
  sections: readonly NoteSection[],
): string {
  return sections
    .map((section) => ({ section, value: row[section]?.trim() }))
    .filter((entry): entry is { section: NoteSection; value: string } => Boolean(entry.value))
    .map((entry) => `${entry.section}: ${entry.value}`)
    .join('\n');
}

export class RetrievalService {
  constructor(
    private readonly deps: {
      prisma: PrismaClient;
      lookbackDays?: number;
      maxItems?: number;
      maxItemsPerSourceType?: number;
      maxProjectionLagSeconds?: number;
      now?: () => Date;
    },
  ) {}

  private get now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
    const lookbackDays = clamp(
      request.lookbackDays ?? this.deps.lookbackDays,
      RETRIEVAL_DEFAULTS.lookbackDays,
      RETRIEVAL_DEFAULTS.maxLookbackDays,
    );
    const maxItems = clamp(
      request.maxItems ?? this.deps.maxItems,
      RETRIEVAL_DEFAULTS.maxItems,
      RETRIEVAL_DEFAULTS.maxItemsHardLimit,
    );
    const maxItemsPerSourceType = clamp(
      this.deps.maxItemsPerSourceType,
      RETRIEVAL_DEFAULTS.maxItemsPerSourceType,
      RETRIEVAL_DEFAULTS.maxItemsHardLimit,
    );
    const since = new Date(this.now.getTime() - lookbackDays * 86_400_000);

    const lag = await this.projectionLagSeconds(request.tenantId, request.patientId);
    const bound = this.deps.maxProjectionLagSeconds ?? RETRIEVAL_DEFAULTS.maxProjectionLagSeconds;
    const usedSourceFallback = lag === null || lag > bound;

    /*
     * Counted per call, not on the instance. One service is shared by every job, so a field would
     * make two concurrent retrievals report each other's exclusions — and a stale count on a draft is
     * worse than no count, because it would be read as an explanation.
     */
    const counters = { excluded: 0 };
    const candidates = usedSourceFallback
      ? await this.fromSourceTables(request, since)
      : await this.fromTimeline(request, since, counters);

    // Most recent first, then capped per type and overall. Newest-first because a doctor reading a
    // draft cares most about what happened last, and the cap should drop the oldest rather than
    // whatever the database returned last.
    candidates.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
    const perType = new Map<RetrievalSourceType, number>();
    const items: RetrievedItem[] = [];
    let droppedByCap = 0;
    for (const candidate of candidates) {
      const used = perType.get(candidate.sourceType) ?? 0;
      if (items.length >= maxItems || used >= maxItemsPerSourceType) {
        droppedByCap += 1;
        continue;
      }
      perType.set(candidate.sourceType, used + 1);
      // Refs are assigned after sorting and capping, so `s1` is always the most recent item sent.
      items.push({ ...candidate, ref: `s${items.length + 1}` });
    }

    const draft = await this.currentDraft(request);
    if (draft && items.length < maxItems) {
      items.push({ ...draft, ref: `s${items.length + 1}` });
    } else if (draft) {
      droppedByCap += 1;
    }

    return {
      items,
      effective: {
        lookbackDays,
        maxItems,
        maxItemsPerSourceType,
        usedSourceFallback,
        projectionLagSeconds: lag,
        droppedByCap,
        droppedByExclusion: counters.excluded,
      },
    };
  }

  /**
   * How far behind the timeline is for this patient, in seconds.
   *
   * Null where nothing has been projected yet, which is treated as stale: a patient with no projection
   * is exactly the case where the source tables are the only place the record exists.
   */
  private async projectionLagSeconds(tenantId: string, patientId: string): Promise<number | null> {
    const [newestEvent, newestSource] = await Promise.all([
      this.deps.prisma.timelineEvent.findFirst({
        where: { tenantId, patientId },
        orderBy: { occurredAt: 'desc' },
        select: { occurredAt: true },
      }),
      this.deps.prisma.encounter.findFirst({
        where: { tenantId, patientId },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }),
    ]);
    if (!newestEvent) return null;
    if (!newestSource) return 0;
    const seconds = Math.round((newestSource.updatedAt.getTime() - newestEvent.occurredAt.getTime()) / 1000);
    return Math.max(0, seconds);
  }

  /** Candidates discovered through the projection, each then loaded from its owning table. */
  private async fromTimeline(
    request: RetrievalRequest,
    since: Date,
    counters: { excluded: number },
  ): Promise<Omit<RetrievedItem, 'ref'>[]> {
    const events = await this.deps.prisma.timelineEvent.findMany({
      where: {
        tenantId: request.tenantId,
        patientId: request.patientId,
        occurredAt: { gte: since },
        visibility: 'CLINICAL',
      },
      orderBy: { occurredAt: 'desc' },
      // Generous: the caps apply after exclusions, so a page full of redacted entries must not starve
      // the result.
      take: RETRIEVAL_DEFAULTS.maxItemsHardLimit * 4,
    });

    // A redaction excludes its original as well as itself: the doctor removed that entry from the
    // record, and retrieving the original would put it back.
    const redacted = new Set<string>();
    for (const event of events) {
      if (event.eventType === 'REDACTED' || event.redactsTimelineEventId) {
        redacted.add(event.id);
        if (event.redactsTimelineEventId) redacted.add(event.redactsTimelineEventId);
      }
    }

    const wanted = events.filter((event) => !redacted.has(event.id));
    counters.excluded += events.length - wanted.length;
    const bySource = new Map<string, string[]>();
    for (const event of wanted) {
      const list = bySource.get(event.sourceType) ?? [];
      list.push(event.sourceId);
      bySource.set(event.sourceType, list);
    }
    const items = await this.loadSources(request, bySource, since);
    // Anything the projection pointed at that the owning table no longer agrees with.
    counters.excluded += Math.max(0, wanted.length - items.length);
    return items;
  }

  /**
   * Loads each candidate from the table that owns it.
   *
   * Source types the projection uses are mapped here; one it reports that this service does not read
   * is skipped rather than guessed at.
   */
  private async loadSources(
    request: RetrievalRequest,
    bySource: ReadonlyMap<string, readonly string[]>,
    since: Date,
  ): Promise<Omit<RetrievedItem, 'ref'>[]> {
    const ids = (type: string) => [...(bySource.get(type) ?? [])];
    const direct = await this.fromSourceTables(request, since, {
      diagnosisIds: ids('diagnosis'),
      prescriptionIds: ids('prescription'),
      noteVersionIds: ids('encounter_note_version'),
      followUpIds: ids('follow_up_plan'),
      encounterIds: ids('encounter'),
    });
    return direct;
  }

  /**
   * The source tables, with the same filters the projection path applies.
   *
   * Used both as the fallback for a stale projection and to resolve the projection's candidates, so
   * the exclusions are written once: a second copy of "voided prescriptions are not retrieved" is a
   * second place for it to be forgotten.
   */
  private async fromSourceTables(
    request: RetrievalRequest,
    since: Date,
    only?: {
      diagnosisIds?: string[];
      prescriptionIds?: string[];
      noteVersionIds?: string[];
      followUpIds?: string[];
      encounterIds?: string[];
    },
  ): Promise<Omit<RetrievedItem, 'ref'>[]> {
    const scope = { tenantId: request.tenantId };
    const limit = RETRIEVAL_DEFAULTS.maxItemsHardLimit;
    const inIds = (ids: string[] | undefined) => (ids && ids.length > 0 ? { in: ids } : undefined);
    const restricted = only !== undefined;

    const [diagnoses, prescriptions, noteVersions, followUps] = await Promise.all([
      restricted && !inIds(only.diagnosisIds)
        ? []
        : this.deps.prisma.diagnosis.findMany({
            where: {
              ...scope,
              patientId: request.patientId,
              ...(inIds(only?.diagnosisIds) ? { id: inIds(only?.diagnosisIds) } : {}),
              createdAt: { gte: since },
              /*
               * `ENTERED_IN_ERROR` is the voided state: a CHECK on this table makes that status and
               * the void fields equivalent, so one condition covers both and a second would only be
               * another place for the rule to drift. `RULED_OUT` is deliberately kept — a diagnosis
               * the doctor considered and excluded is clinical context, not a mistake.
               */
              clinicalStatus: { not: 'ENTERED_IN_ERROR' },
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
          }),
      restricted && !inIds(only.prescriptionIds)
        ? []
        : this.deps.prisma.prescription.findMany({
            where: {
              ...scope,
              patientId: request.patientId,
              ...(inIds(only?.prescriptionIds) ? { id: inIds(only?.prescriptionIds) } : {}),
              createdAt: { gte: since },
              // Approved only: a draft is a doctor still thinking, and a void is one who changed
              // their mind.
              clinicalStatus: 'APPROVED',
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
          }),
      restricted && !inIds(only.noteVersionIds)
        ? []
        : this.deps.prisma.encounterNoteVersion.findMany({
            where: {
              ...scope,
              ...(inIds(only?.noteVersionIds) ? { id: inIds(only?.noteVersionIds) } : {}),
              signedAt: { gte: since },
              // Signed notes only. A superseded revision is excluded below, after the latest per
              // encounter is known.
            },
            orderBy: { signedAt: 'desc' },
            take: limit * 2,
          }),
      restricted && !inIds(only.followUpIds)
        ? []
        : this.deps.prisma.followUpPlan.findMany({
            where: {
              ...scope,
              patientId: request.patientId,
              ...(inIds(only?.followUpIds) ? { id: inIds(only?.followUpIds) } : {}),
              createdAt: { gte: since },
              status: { notIn: ['CANCELLED'] },
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
          }),
    ]);

    // One note per encounter: the newest signed revision. An earlier revision was corrected, and
    // sending both would show the model a contradiction it has no way to resolve.
    const newestRevision = new Map<string, (typeof noteVersions)[number]>();
    for (const version of noteVersions) {
      const current = newestRevision.get(version.encounterId);
      if (!current || version.revision > current.revision) newestRevision.set(version.encounterId, version);
    }

    const items: Omit<RetrievedItem, 'ref'>[] = [];
    for (const row of diagnoses) {
      items.push({
        sourceType: 'diagnosis',
        sourceId: row.id,
        occurredAt: row.createdAt,
        text: [row.display, row.clinicalStatus, row.certainty].filter(Boolean).join(' — '),
      });
    }
    for (const row of prescriptions) {
      items.push({
        sourceType: 'prescription',
        sourceId: row.id,
        occurredAt: row.createdAt,
        // Identifiers and status only. The items belong to the prescription context, and a retrieval
        // that inlined them would be a second copy of a clinical record built here.
        text: `Prescription approved (revision ${row.revision ?? 1}).`,
      });
    }
    for (const row of newestRevision.values()) {
      const text = noteText(row, NOTE_SECTIONS);
      if (text.length === 0) continue;
      items.push({
        sourceType: 'encounter_note_version',
        sourceId: row.id,
        occurredAt: row.signedAt,
        text,
      });
    }
    for (const row of followUps) {
      items.push({
        sourceType: 'follow_up_plan',
        sourceId: row.id,
        occurredAt: row.createdAt,
        text: `Follow-up planned for ${row.dueStartDate.toISOString().slice(0, 10)}: ${row.reason}`,
      });
    }
    return items;
  }

  /**
   * This encounter's draft note, limited to the sections the doctor selected.
   *
   * The only draft ever read. Another encounter's draft is work in progress that its author has not
   * signed, and a model summarising it would present an unfinished thought as part of the record.
   */
  private async currentDraft(request: RetrievalRequest): Promise<Omit<RetrievedItem, 'ref'> | null> {
    const sections = (request.draftSections ?? []).filter((section): section is NoteSection =>
      (NOTE_SECTIONS as readonly string[]).includes(section),
    );
    if (sections.length === 0) return null;
    const note = await this.deps.prisma.encounterNote.findFirst({
      where: { tenantId: request.tenantId, encounterId: request.encounterId },
      orderBy: { updatedAt: 'desc' },
    });
    if (!note) return null;
    const text = noteText(note, sections);
    if (text.length === 0) return null;
    return {
      sourceType: 'encounter_note_draft',
      sourceId: note.id,
      occurredAt: note.updatedAt,
      text,
    };
  }
}
