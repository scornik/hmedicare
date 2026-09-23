import { AppError, type Clock, newId, systemClock } from '@hmedic/kernel';
import { type Prisma, type PrismaClient, lockRow, withTransaction } from '@hmedic/database';
import { ChainAppender, type PrismaAuditPort } from '@hmedic/audit';
import type { Metrics } from '@hmedic/observability';
import { NOTE_SECTIONS, type NoteSection } from '../domain/encounter-transitions';
import {
  MAX_SECTION_CHARS,
  type NoteSectionSourceEntry,
  type NoteSectionText,
  isEmptyNote,
  noteChainKey,
  noteContentSha256,
  normalizeSections,
  oversizedSections,
} from '../domain/note-sections';
import type { ClinicalAccessPolicy } from './clinical-access';
import type { ClinicalActor } from './encounter-service';
import type { ClinicalOutbox } from './events';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

const TX_OPTS = { timeout: 15_000, maxWait: 10_000 } as const;

export interface NoteDraftView {
  id: string;
  encounterId: string;
  authorDoctorProfileId: string;
  status: string;
  chiefComplaint: string | null;
  history: string | null;
  examination: string | null;
  assessment: string | null;
  plan: string | null;
  sectionSources: NoteSectionSourceEntry[];
  schemaVersion: number;
  lastSignedRevision: number | null;
  updatedAt: string;
  rowVersion: number;
}

export interface NoteRevisionView {
  id: string;
  encounterId: string;
  revision: number;
  signedByDoctorProfileId: string;
  signedAt: string;
  chiefComplaint: string | null;
  history: string | null;
  examination: string | null;
  assessment: string | null;
  plan: string | null;
  sectionSources: NoteSectionSourceEntry[];
  schemaVersion: number;
  correctionReason: string | null;
  supersedesRevision: number | null;
  contentSha256: string;
}

type DraftRow = {
  id: string;
  encounterId: string;
  authorDoctorProfileId: string;
  status: string;
  chiefComplaint: string | null;
  history: string | null;
  examination: string | null;
  assessment: string | null;
  plan: string | null;
  sectionSources: unknown;
  schemaVersion: number;
  lastSignedRevision: number | null;
  updatedAt: Date;
  rowVersion: number;
};

function sources(value: unknown): NoteSectionSourceEntry[] {
  return Array.isArray(value) ? (value as NoteSectionSourceEntry[]) : [];
}

export function noteDraftView(r: DraftRow): NoteDraftView {
  return {
    id: r.id,
    encounterId: r.encounterId,
    authorDoctorProfileId: r.authorDoctorProfileId,
    status: r.status,
    chiefComplaint: r.chiefComplaint,
    history: r.history,
    examination: r.examination,
    assessment: r.assessment,
    plan: r.plan,
    sectionSources: sources(r.sectionSources),
    schemaVersion: r.schemaVersion,
    lastSignedRevision: r.lastSignedRevision,
    updatedAt: r.updatedAt.toISOString(),
    rowVersion: r.rowVersion,
  };
}

/**
 * Encounter notes (CLIN-003). One mutable draft per encounter, and an append-only chain of signed
 * revisions beside it.
 *
 * Two rules shape everything here.
 *
 * **A signed revision is never rewritten.** Not by an amendment, not by a later save, not by an admin.
 * A correction is a new revision carrying its reason, and the one it corrects stays readable — because a
 * record that can be edited after the fact cannot answer "what did the doctor know at the time", which is
 * the only question anyone asks of it later.
 *
 * **A save never wins silently.** Every write carries the draft's `row_version`, and a stale one is
 * refused with the current state attached so the client can show the doctor both versions. The failure
 * mode this avoids is the quiet one: two tabs open, the older overwriting the newer, and nobody finding
 * out until the text that mattered is gone.
 */
export class NoteService {
  private readonly appender = new ChainAppender();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: PrismaAuditPort,
    private readonly outbox: ClinicalOutbox,
    private readonly access: ClinicalAccessPolicy,
    private readonly clock: Clock = systemClock,
    /** Optional so the service can be built without a metrics registry, as the tests do. */
    private readonly metrics?: Metrics,
  ) {}

  private correlation(actor: ClinicalActor) {
    return {
      requestId: actor.requestId ?? null,
      correlationId: actor.correlationId ?? actor.requestId ?? newId(),
    };
  }

  /**
   * Reading and drafting: the assigned doctor, or a nurse working in that chamber. The matrix grants
   * nurses the draft and withholds the signature, so the two are authorized separately rather than
   * through one flag (see `ClinicalAccessPolicy`).
   */
  private async authorize(actor: ClinicalActor, encounterId: string) {
    const { encounter, footing } = await this.access.assignedOrScoped(actor, encounterId);
    return { tenantId: actor.tenant.tenantId, encounter, footing };
  }

  private async draftOf(tenantId: string, encounterId: string): Promise<DraftRow> {
    const row = await this.prisma.encounterNote.findFirst({ where: { tenantId, encounterId } });
    if (!row) throw new AppError('RESOURCE_NOT_FOUND');
    return row as DraftRow;
  }

  /**
   * Reading the draft is a PHI read, so it is audited (test 10). The audit row records who looked at
   * which record and when — never what it said. An audit trail that copies the note is a second, less
   * protected copy of the note.
   */
  async getDraft(actor: ClinicalActor, encounterId: string): Promise<NoteDraftView> {
    const { tenantId } = await this.authorize(actor, encounterId);
    const row = await this.draftOf(tenantId, encounterId);
    await this.auditRead(actor, 'ENCOUNTER_NOTE_VIEWED', encounterId, {
      noteId: row.id,
      lastSignedRevision: row.lastSignedRevision,
    });
    return noteDraftView(row);
  }

  async listRevisions(actor: ClinicalActor, encounterId: string): Promise<NoteRevisionView[]> {
    const { tenantId } = await this.authorize(actor, encounterId);
    const rows = await this.prisma.encounterNoteVersion.findMany({
      where: { tenantId, encounterId },
      orderBy: { revision: 'asc' },
    });
    await this.auditRead(actor, 'ENCOUNTER_NOTE_HISTORY_VIEWED', encounterId, {
      revisionCount: rows.length,
    });
    return rows.map((r) => ({
      id: r.id,
      encounterId: r.encounterId,
      revision: r.revision,
      signedByDoctorProfileId: r.signedByDoctorProfileId,
      signedAt: r.signedAt.toISOString(),
      chiefComplaint: r.chiefComplaint,
      history: r.history,
      examination: r.examination,
      assessment: r.assessment,
      plan: r.plan,
      sectionSources: sources(r.sectionSources),
      schemaVersion: r.schemaVersion,
      correctionReason: r.correctionReason,
      supersedesRevision: r.supersedesRevision,
      contentSha256: r.contentSha256,
    }));
  }

  /**
   * Autosave. Idempotent in the sense the client needs: the same `expectedRowVersion` twice means the
   * second call lost, and says so rather than applying the same text again over newer text.
   *
   * No event and no audit row per save. Audit covers create, sign, amend and view (prompt §3.2): a row
   * per keystroke would bury the entries that matter under thousands that do not, and would make the
   * audit chain a transcript of typing.
   */
  async saveDraft(
    actor: ClinicalActor,
    encounterId: string,
    input: { expectedRowVersion: number; sections: NoteSectionText },
  ): Promise<NoteDraftView> {
    const { tenantId, encounter, footing } = await this.authorize(actor, encounterId);
    const tooLong = oversizedSections(input.sections);
    if (tooLong.length > 0) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fieldErrors: tooLong.map((section) => ({
          path: `sections.${section}`,
          code: 'too_long',
          message: 'validation.tooLong',
        })),
        details: { maxChars: MAX_SECTION_CHARS },
      });
    }
    // A note belongs to the consultation it was written in. Once that is over, the record is closed and
    // changes go through a signed correction.
    if (encounter.status !== 'IN_PROGRESS' && encounter.status !== 'INTERRUPTED') {
      throw new AppError('INVALID_TRANSITION', undefined, {
        details: { encounterStatus: encounter.status, command: 'saveDraft' },
      });
    }

    const sections = normalizeSections(input.sections);
    const now = this.clock.now();
    const counted = (outcome: string) => this.metrics?.noteAutosaves.inc({ outcome });

    const row = await withTransaction(
      this.prisma,
      async (tx) => {
        // Locate the draft, lock it, then re-read: between those two statements another tab may have
        // saved, and the version check has to run against what the lock is actually holding.
        const found = await tx.encounterNote.findFirst({
          where: { tenantId, encounterId },
          select: { id: true },
        });
        if (!found) throw new AppError('RESOURCE_NOT_FOUND');
        await lockRow(tx, 'encounter_notes', found.id, tenantId);
        const draft = (await tx.encounterNote.findFirst({ where: { id: found.id } })) as DraftRow | null;
        if (!draft) throw new AppError('RESOURCE_NOT_FOUND');
        if (draft.status !== 'DRAFT') {
          throw new AppError('INVALID_TRANSITION', undefined, {
            details: { noteStatus: draft.status, command: 'saveDraft' },
          });
        }
        if (draft.rowVersion !== input.expectedRowVersion) {
          // The current version travels with the refusal so the client can fetch and show both sides
          // rather than guessing that it is behind.
          counted('conflict');
          throw new AppError('STALE_VERSION', undefined, {
            details: { currentRowVersion: draft.rowVersion, lastSignedRevision: draft.lastSignedRevision },
          });
        }
        const updated = await tx.encounterNote.update({
          where: { id: draft.id },
          data: {
            ...sections,
            sectionSources: sectionSourcesFor(
              sections,
              footing === 'assigned' ? 'doctor' : 'nurse',
            ) as unknown as Prisma.InputJsonValue,
            updatedAt: now,
            updatedByUserId: actor.userId,
            rowVersion: { increment: 1 },
          },
        });
        await this.outbox.emit(tx, {
          tenantId,
          name: 'EncounterNoteDraftSaved',
          aggregateType: 'encounter_note',
          aggregateId: draft.id,
          // Not projected to the timeline, and carrying no text: a subscriber learns that a draft moved,
          // never what it now says. The note's own id is the event's `aggregateId`, so repeating it here
          // would only be a second copy of a key the PHI deny-list refuses by name.
          payload: { encounterId, rowVersion: updated.rowVersion },
          actorId: actor.userId,
          correlationId: this.correlation(actor).correlationId,
        });
        return updated as DraftRow;
      },
      { ...TX_OPTS, context: 'note:save' },
    );
    counted('saved');
    return noteDraftView(row);
  }

  /**
   * Sign, and amend, which is the same operation with a reason attached.
   *
   * Revision 1 is a signature. Every revision after it is a correction and the database refuses one
   * without a reason (`chk_encounter_note_versions_correction`), so the history explains itself without
   * anyone having to remember to write it down.
   */
  async sign(
    actor: ClinicalActor,
    encounterId: string,
    input: { expectedRowVersion: number; correctionReason?: string | null },
    opts: { idempotencyKey?: string | null } = {},
  ): Promise<NoteRevisionView> {
    // Signing demands assignment, never scope: a signature says a named doctor stands behind the record.
    const { encounter } = await this.access.assigned(actor, encounterId);
    const tenantId = actor.tenant.tenantId;
    if (!actor.doctorProfileId) throw new AppError('FORBIDDEN');
    if (encounter.status === 'ENTERED_IN_ERROR') {
      throw new AppError('INVALID_TRANSITION', undefined, {
        details: { encounterStatus: encounter.status, command: 'sign' },
      });
    }

    const { requestId, correlationId } = this.correlation(actor);
    const now = this.clock.now();
    const startedAt = process.hrtime.bigint();

    const result = await withTransaction(
      this.prisma,
      async (tx) => {
        const draft = (await tx.encounterNote.findFirst({
          where: { tenantId, encounterId },
        })) as DraftRow | null;
        if (!draft) throw new AppError('RESOURCE_NOT_FOUND');
        await lockRow(tx, 'encounter_notes', draft.id, tenantId);
        const locked = (await tx.encounterNote.findFirst({ where: { id: draft.id } })) as DraftRow;
        if (locked.rowVersion !== input.expectedRowVersion) {
          throw new AppError('STALE_VERSION', undefined, {
            details: {
              currentRowVersion: locked.rowVersion,
              lastSignedRevision: locked.lastSignedRevision,
            },
          });
        }

        const sections = {
          chiefComplaint: locked.chiefComplaint,
          history: locked.history,
          examination: locked.examination,
          assessment: locked.assessment,
          plan: locked.plan,
        } as Record<NoteSection, string | null>;
        if (isEmptyNote(sections)) {
          throw new AppError('VALIDATION_FAILED', undefined, {
            fieldErrors: [{ path: 'sections', code: 'required', message: 'validation.required' }],
            details: { reason: 'empty_note' },
          });
        }

        const revision = (locked.lastSignedRevision ?? 0) + 1;
        const correctionReason = input.correctionReason?.trim() || null;
        if (revision > 1 && !correctionReason) {
          throw new AppError('VALIDATION_FAILED', undefined, {
            fieldErrors: [{ path: 'correctionReason', code: 'required', message: 'validation.required' }],
            details: { revision },
          });
        }
        if (revision === 1 && correctionReason) {
          // A first signature corrects nothing. Accepting a reason here would put a sentence in the
          // record that reads as though an earlier version existed.
          throw new AppError('VALIDATION_FAILED', undefined, {
            fieldErrors: [
              { path: 'correctionReason', code: 'not_allowed', message: 'validation.notAllowed' },
            ],
            details: { revision },
          });
        }

        const contentSha256 = noteContentSha256({
          sections,
          extensions: null,
          schemaVersion: locked.schemaVersion,
        });
        const versionId = newId();
        const base = {
          id: versionId,
          tenantId,
          encounterId,
          noteId: locked.id,
          revision,
          signedByDoctorProfileId: actor.doctorProfileId!,
          signedAt: now,
          ...sections,
          sectionSources: sources(locked.sectionSources),
          schemaVersion: locked.schemaVersion,
          correctionReason,
          supersedesRevision: revision > 1 ? revision - 1 : null,
          contentSha256,
        };

        // One chain per encounter: a revision's hash covers the one before it, so removing or rewriting
        // a middle revision breaks every hash after it rather than going unnoticed.
        const { rowHash } = await this.appender.append(
          tx,
          noteChainKey(tenantId, encounterId),
          now,
          (slot) => ({ ...base, signedAt: now.toISOString(), seq: slot.seq.toString() }),
          async (slot, hash) => {
            await tx.encounterNoteVersion.create({
              data: {
                ...base,
                sectionSources: base.sectionSources as unknown as Prisma.InputJsonValue,
                prevRowHash: slot.prevRowHash,
                rowHash: hash,
                createdAt: now,
              },
            });
          },
        );
        void rowHash;

        await tx.encounterNote.update({
          where: { id: locked.id },
          data: {
            lastSignedRevision: revision,
            updatedAt: now,
            updatedByUserId: actor.userId,
            rowVersion: { increment: 1 },
          },
        });

        await this.audit.append(tx, {
          tenantId,
          actorUserId: actor.userId,
          actorType: 'USER',
          action: revision === 1 ? 'ENCOUNTER_NOTE_SIGNED' : 'ENCOUNTER_NOTE_AMENDED',
          resourceType: 'encounter_note',
          resourceId: locked.id,
          outcome: 'SUCCESS',
          requestId,
          correlationId,
          // Identifiers and a content digest. The digest lets anyone prove later that a revision is the
          // one that was signed, without the audit log holding the text to compare against.
          metadata: { encounterId, revision, contentSha256, amended: revision > 1 },
        });

        await this.outbox.emit(tx, {
          tenantId,
          name: 'EncounterNoteSigned',
          aggregateType: 'encounter_note',
          aggregateId: locked.id,
          payload: {
            encounterId,
            versionId,
            revision,
            // The documented catalogue has no separate amend event, so the projector tells the two apart
            // by this flag rather than by a name that does not exist (see audit row C-53).
            amended: revision > 1,
            signedByDoctorProfileId: actor.doctorProfileId!,
            patientId: encounter.patientId,
          },
          actorId: actor.userId,
          correlationId,
          idempotencyKey: opts.idempotencyKey ? `${opts.idempotencyKey}:EncounterNoteSigned` : null,
        });

        return base;
      },
      { ...TX_OPTS, context: 'note:sign' },
    );
    this.metrics?.noteSignDuration.observe(
      { kind: result.revision === 1 ? 'signature' : 'correction' },
      Number(process.hrtime.bigint() - startedAt) / 1e9,
    );

    return {
      id: result.id,
      encounterId: result.encounterId,
      revision: result.revision,
      signedByDoctorProfileId: result.signedByDoctorProfileId,
      signedAt: result.signedAt.toISOString(),
      chiefComplaint: result.chiefComplaint,
      history: result.history,
      examination: result.examination,
      assessment: result.assessment,
      plan: result.plan,
      sectionSources: result.sectionSources,
      schemaVersion: result.schemaVersion,
      correctionReason: result.correctionReason,
      supersedesRevision: result.supersedesRevision,
      contentSha256: result.contentSha256,
    };
  }

  /**
   * Called when the encounter completes: the draft stops accepting saves. It is not deleted and its text
   * is not cleared — the last signed revision is the record, and the draft beside it shows what was in
   * the editor when the door closed.
   */
  async lockDraftForCompletion(tx: Tx, tenantId: string, encounterId: string, now: Date): Promise<void> {
    const draft = await tx.encounterNote.findFirst({
      where: { tenantId, encounterId },
      select: { id: true, status: true, lastSignedRevision: true },
    });
    if (!draft || draft.status !== 'DRAFT') return;
    await lockRow(tx, 'encounter_notes', draft.id, tenantId);
    await tx.encounterNote.update({
      where: { id: draft.id },
      data: { status: 'SIGNED_LOCKED', updatedAt: now, rowVersion: { increment: 1 } },
    });
  }

  private async auditRead(
    actor: ClinicalActor,
    action: string,
    encounterId: string,
    metadata: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    this.metrics?.phiReads.inc({ resource: 'encounter_note' });
    const { requestId, correlationId } = this.correlation(actor);
    await withTransaction(
      this.prisma,
      (tx) =>
        this.audit.append(tx, {
          tenantId: actor.tenant.tenantId,
          actorUserId: actor.userId,
          actorType: 'USER',
          action,
          resourceType: 'encounter_note',
          resourceId: encounterId,
          outcome: 'SUCCESS',
          requestId,
          correlationId,
          metadata,
        }),
      { ...TX_OPTS, context: 'note:audit-read' },
    );
  }
}

/** Every section a doctor typed is sourced to the doctor. Stage 10 adds the approved-AI case. */
function sectionSourcesFor(
  sections: Record<NoteSection, string | null>,
  source: NoteSectionSourceEntry['source'],
): NoteSectionSourceEntry[] {
  return NOTE_SECTIONS.filter((s) => sections[s] !== null).map((section) => ({ section, source }));
}
