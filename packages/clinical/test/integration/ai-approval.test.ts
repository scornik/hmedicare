import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@hmedic/kernel';
import type { Database } from '@hmedic/database';
import { PrismaAuditPort, VerifyAppendOnlyChains, auditChainSource } from '@hmedic/audit';
import { AI_APPROVAL_CHAIN_PREFIX, aiApprovalChainSource } from '@hmedic/ai';
import { type ClinicalActor, composeClinical } from '../../src/public';
import { openTestDatabase, rawConnection, truncateAll } from '../../../../tests/support/db';
import { chamberWithCalledSerial, tenantContext } from '../../../../tests/support/clinical';

/**
 * `ApproveAISuggestion` (AI-003, AI-IMPLEMENTATION §7.4).
 *
 * This is the only path from a draft to a chart, so the cases are about the two ways it could go
 * wrong: writing something nobody attested, or writing it without the evidence that they did.
 *
 * Atomicity is asserted by its failures rather than its successes. When the note write refuses — a
 * stale draft, a signed note — no approval row exists and the suggestion is still waiting, because
 * the whole thing is one transaction. That is the property that makes `source='ai_approved'` on a
 * diagnosis mean something: the database CHECK requires an approval id, and the approval cannot
 * commit without the record.
 */
let db: Database;
let clinical: ReturnType<typeof composeClinical>;
const now = new Date('2026-10-13T11:00:00Z');
let seq = 0;

const serials = {
  attachEncounterInterruption: () => undefined,
} as unknown as Parameters<typeof composeClinical>[0]['serials'];

beforeAll(() => {
  db = openTestDatabase();
  clinical = composeClinical({
    prisma: db.prisma,
    audit: new PrismaAuditPort({ now: () => now }),
    serials,
    clock: { now: () => now },
  });
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await truncateAll();
});

/** A consultation with a draft note, an AI draft and one accepted suggestion of each kind. */
async function fixture(options: { suggestionType?: 'NOTE_SECTION' | 'DIAGNOSIS' } = {}) {
  const base = await chamberWithCalledSerial(db.prisma, `appr${++seq}`, now);
  await db.prisma.tenantMembership.create({
    data: {
      id: newId(),
      tenantId: base.tenantId,
      userId: base.userId,
      role: 'doctor',
      permissions: { grants: [] },
      clinicIds: [],
      chamberIds: [],
      status: 'ACTIVE',
      rolePermissionsVersion: 2,
      createdAt: now,
      updatedAt: now,
    },
  });
  const encounterId = newId();
  await db.prisma.encounter.create({
    data: {
      id: encounterId,
      tenantId: base.tenantId,
      patientId: base.patientId,
      doctorProfileId: base.doctorProfileId,
      chamberId: base.chamberId,
      serialId: base.serial.id,
      careMode: 'PHYSICAL',
      status: 'IN_PROGRESS',
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
  const note = await db.prisma.encounterNote.create({
    data: {
      id: newId(),
      tenantId: base.tenantId,
      encounterId,
      authorDoctorProfileId: base.doctorProfileId,
      status: 'DRAFT',
      history: 'What the doctor wrote.',
      sectionSources: [{ section: 'history', source: 'doctor' }],
      createdAt: now,
      updatedAt: now,
    },
  });
  const credential = await db.prisma.aiProviderCredential.create({
    data: {
      id: newId(),
      tenantId: base.tenantId,
      doctorProfileId: base.doctorProfileId,
      providerCode: 'mock',
      declaredTier: 'FREE',
      billingMode: 'DOCTOR_BYOK_FREE',
      encryptedSecret: 'x',
      wrappedDataKey: 'x',
      keyId: 'test-ai-1',
      secretLast4: '6789',
      secretFingerprint: newId().replace(/-/g, ''),
      status: 'ACTIVE',
      allowedModelIds: [],
      createdByUserId: base.userId,
      createdAt: now,
      updatedAt: now,
    },
  });
  const job = await db.prisma.aiJob.create({
    data: {
      id: newId(),
      tenantId: base.tenantId,
      requestedByUserId: base.userId,
      doctorProfileId: base.doctorProfileId,
      patientId: base.patientId,
      encounterId,
      purpose: 'NOTE_DRAFT',
      status: 'SUCCEEDED',
      finishedAt: now,
      credentialId: credential.id,
      providerCode: 'mock',
      modelId: 'mock-text-1',
      declaredTier: 'FREE',
      billingMode: 'DOCTOR_BYOK_FREE',
      effectiveDataUsePolicy: 'MAY_TRAIN_OR_REVIEW',
      promptTemplateVersion: 'note-draft/v1',
      outputSchemaVersion: 'note-draft/v1',
      sourceSelection: {},
      correlationId: newId(),
      idempotencyKey: `appr-${newId()}`,
      createdAt: now,
      updatedAt: now,
    },
  });
  const draft = await db.prisma.aiDraft.create({
    data: {
      id: newId(),
      tenantId: base.tenantId,
      aiJobId: job.id,
      encounterId,
      patientId: base.patientId,
      draftType: 'NOTE_DRAFT',
      status: 'IN_REVIEW',
      openedAt: now,
      outputSchemaVersion: 'note-draft/v1',
      validatedOutput: { suggestions: [] },
      expiresAt: new Date(now.getTime() + 72 * 3600_000),
      createdAt: now,
      updatedAt: now,
    },
  });
  const suggestionType = options.suggestionType ?? 'NOTE_SECTION';
  const suggestion = await db.prisma.aiSuggestion.create({
    data: {
      id: newId(),
      tenantId: base.tenantId,
      aiDraftId: draft.id,
      suggestionType,
      ...(suggestionType === 'NOTE_SECTION' ? { targetSection: 'history' } : {}),
      sourceRefs: [{ sourceType: 'diagnosis', sourceId: newId(), occurredAt: now.toISOString() }],
      candidate:
        suggestionType === 'NOTE_SECTION'
          ? { suggestionType, targetSection: 'history', text: 'SYNTHETIC proposed history.' }
          : { suggestionType, display: 'SYNTHETIC bronchitis', certainty: 'PROVISIONAL' },
      confidence: 'MEDIUM',
      // Accepted: a doctor cannot approve what they have not said yes to.
      status: 'ACCEPTED',
      reviewedAt: now,
      reviewedByDoctorProfileId: base.doctorProfileId,
      createdAt: now,
      updatedAt: now,
    },
  });
  return { ...base, encounterId, noteId: note.id, draftId: draft.id, suggestion };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** An actor carrying the doctor role's permissions, as the API's resolver would build it. */
const actor = (f: Fixture, permissions = ['ai.approve', 'note.write', 'diagnosis.write']): ClinicalActor => ({
  userId: f.userId,
  tenant: { ...tenantContext(f.tenantId), effectivePermissions: new Set(permissions) },
  doctorProfileId: f.doctorProfileId,
  requestId: newId(),
  correlationId: newId(),
});

const noteSection = (text = 'SYNTHETIC proposed history.', mode: 'APPEND' | 'REPLACE' = 'APPEND') => ({
  approvedTarget: 'ENCOUNTER_NOTE_SECTION' as const,
  expectedRowVersion: 1,
  attestationVersion: 1,
  noteSection: { section: 'history', mode, text, expectedNoteRowVersion: 1 },
});

describe('approving a note section', () => {
  it('appends to what the doctor wrote and records the approval', async () => {
    const f = await fixture();
    const approval = await clinical.aiApprovals.approve(actor(f), f.suggestion.id, noteSection());

    expect(approval).toMatchObject({
      approvedTarget: 'ENCOUNTER_NOTE_SECTION',
      approvedRecordType: 'encounter_note',
      approvedSection: 'history',
      attestationVersion: 1,
    });
    const note = await db.prisma.encounterNote.findFirstOrThrow({ where: { id: f.noteId } });
    // Appended, not replaced: an approved suggestion joins the doctor's own words rather than erasing
    // them.
    expect(note.history).toBe('What the doctor wrote.\nSYNTHETIC proposed history.');
    // The section's provenance now names the approval, which is what makes the claim checkable.
    expect(note.sectionSources).toMatchObject([
      { section: 'history', source: 'ai_approved', aiApprovalId: approval.id },
    ]);
    const suggestion = await db.prisma.aiSuggestion.findFirstOrThrow({ where: { id: f.suggestion.id } });
    expect(suggestion.status).toBe('APPROVED');
  });

  it('replaces the section when asked', async () => {
    const f = await fixture();
    await clinical.aiApprovals.approve(
      actor(f),
      f.suggestion.id,
      noteSection('SYNTHETIC replacement.', 'REPLACE'),
    );
    const note = await db.prisma.encounterNote.findFirstOrThrow({ where: { id: f.noteId } });
    // A doctor who accepted an AI version of a section they drafted badly should not have to clear it
    // first.
    expect(note.history).toBe('SYNTHETIC replacement.');
  });

  it('refuses when the note draft has moved underneath', async () => {
    const f = await fixture();
    await db.prisma.encounterNote.update({
      where: { id: f.noteId },
      data: { history: 'The doctor typed more.', rowVersion: { increment: 1 } },
    });

    await expect(clinical.aiApprovals.approve(actor(f), f.suggestion.id, noteSection())).rejects.toThrow(
      /STALE_VERSION/,
    );
    // Nothing committed: one transaction, so the approval cannot exist without the write.
    expect(await db.prisma.aiApproval.count()).toBe(0);
    expect((await db.prisma.aiSuggestion.findFirstOrThrow({ where: { id: f.suggestion.id } })).status).toBe(
      'ACCEPTED',
    );
  });

  it('refuses once the note is signed', async () => {
    const f = await fixture();
    await db.prisma.encounterNote.update({
      where: { id: f.noteId },
      data: { status: 'SIGNED_LOCKED' },
    });

    // A signed note is fixed. An approved suggestion for one goes through the correction flow, which
    // is a new signed revision with a reason, not a quiet edit.
    await expect(clinical.aiApprovals.approve(actor(f), f.suggestion.id, noteSection())).rejects.toThrow(
      /INVALID_TRANSITION/,
    );
    expect(await db.prisma.aiApproval.count()).toBe(0);
  });
});

describe('approving a diagnosis', () => {
  const diagnosis = {
    approvedTarget: 'DIAGNOSIS' as const,
    expectedRowVersion: 1,
    attestationVersion: 1,
    diagnosis: {
      display: 'SYNTHETIC bronchitis',
      certainty: 'PROVISIONAL' as const,
      codeSystem: 'ICD10',
      code: 'J20.9',
    },
  };

  it('writes the diagnosis with the approval behind it', async () => {
    const f = await fixture({ suggestionType: 'DIAGNOSIS' });
    const approval = await clinical.aiApprovals.approve(actor(f), f.suggestion.id, diagnosis);

    const row = await db.prisma.diagnosis.findFirstOrThrow({ where: { id: approval.approvedRecordId } });
    expect(row.source).toBe('ai_approved');
    // The CHECK on this table refuses `ai_approved` without an approval id, so the label cannot be
    // claimed without the evidence.
    expect(row.aiApprovalId).toBe(approval.id);
    // The doctor who approved it is its author: they read it and decided.
    expect(row.authorDoctorProfileId).toBe(f.doctorProfileId);
    expect(row.code).toBe('J20.9');
  });

  it('refuses a diagnosis payload approved as a note section', async () => {
    const f = await fixture({ suggestionType: 'DIAGNOSIS' });
    // A diagnosis buried in a note section is one nothing downstream can find.
    await expect(clinical.aiApprovals.approve(actor(f), f.suggestion.id, noteSection())).rejects.toThrow(
      /VALIDATION_FAILED/,
    );
  });

  it('refuses a note-section suggestion approved as a diagnosis', async () => {
    const f = await fixture();
    // The other way round would put a paragraph of prose in the diagnosis list.
    await expect(clinical.aiApprovals.approve(actor(f), f.suggestion.id, diagnosis)).rejects.toThrow(
      /VALIDATION_FAILED/,
    );
  });
});

describe('who may approve', () => {
  it('refuses an actor without ai.approve', async () => {
    const f = await fixture();
    // `ai.approve` is doctor-only in the matrix; `ai.review` is not enough to put anything in a chart.
    await expect(
      clinical.aiApprovals.approve(actor(f, ['ai.review', 'note.write']), f.suggestion.id, noteSection()),
    ).rejects.toThrow(/FORBIDDEN/);
    expect(await db.prisma.aiApproval.count()).toBe(0);
  });

  it('refuses a doctor who is not assigned to the encounter', async () => {
    const f = await fixture();
    const other = await fixture();
    const stranger = { ...actor(f), doctorProfileId: other.doctorProfileId, userId: other.userId };
    await expect(clinical.aiApprovals.approve(stranger, f.suggestion.id, noteSection())).rejects.toThrow();
  });
});

describe('what may be approved', () => {
  it('refuses a suggestion the doctor has not accepted', async () => {
    const f = await fixture();
    await db.prisma.aiSuggestion.update({
      where: { id: f.suggestion.id },
      data: { status: 'PENDING', reviewedAt: null, reviewedByDoctorProfileId: null },
    });

    await expect(clinical.aiApprovals.approve(actor(f), f.suggestion.id, noteSection())).rejects.toThrow(
      /AI_REVIEW_REQUIRED/,
    );
  });

  it('refuses a second approval of the same suggestion', async () => {
    const f = await fixture();
    // A second suggestion, so approving the first does not close the draft and the status check is
    // the refusal that fires rather than the closed-draft one.
    const second = await db.prisma.aiSuggestion.create({
      data: {
        id: newId(),
        tenantId: f.tenantId,
        aiDraftId: f.draftId,
        suggestionType: 'NOTE_SECTION',
        targetSection: 'plan',
        sourceRefs: [{ sourceType: 'diagnosis', sourceId: newId(), occurredAt: now.toISOString() }],
        candidate: { suggestionType: 'NOTE_SECTION', targetSection: 'plan', text: 'SYNTHETIC plan.' },
        confidence: 'LOW',
        status: 'PENDING',
        createdAt: now,
        updatedAt: now,
      },
    });
    await clinical.aiApprovals.approve(actor(f), f.suggestion.id, noteSection());

    // Already APPROVED, so review would be required again — and the unique on
    // (suggestion, row version) would refuse it even if the status check did not.
    await expect(
      clinical.aiApprovals.approve(actor(f), f.suggestion.id, {
        ...noteSection(),
        expectedRowVersion: 2,
        noteSection: { ...noteSection().noteSection, expectedNoteRowVersion: 2 },
      }),
    ).rejects.toThrow(/AI_REVIEW_REQUIRED/);
    expect(await db.prisma.aiApproval.count()).toBe(1);
    expect(second.status).toBe('PENDING');
  });

  it('refuses an approval from a stale screen', async () => {
    const f = await fixture();
    await db.prisma.aiSuggestion.update({
      where: { id: f.suggestion.id },
      data: { rowVersion: { increment: 1 } },
    });

    await expect(clinical.aiApprovals.approve(actor(f), f.suggestion.id, noteSection())).rejects.toThrow(
      /STALE_VERSION/,
    );
  });

  it('refuses an approval once the draft is closed', async () => {
    const f = await fixture();
    await db.prisma.aiDraft.update({
      where: { id: f.draftId },
      data: { status: 'CLOSED', closedAt: now },
    });

    await expect(clinical.aiApprovals.approve(actor(f), f.suggestion.id, noteSection())).rejects.toThrow(
      /AI_DRAFT_CLOSED/,
    );
  });

  it('closes the draft when the last suggestion is approved', async () => {
    const f = await fixture();
    await clinical.aiApprovals.approve(actor(f), f.suggestion.id, noteSection());
    // Nothing left to review, so the draft's state matches the work.
    expect((await db.prisma.aiDraft.findFirstOrThrow({ where: { id: f.draftId } })).status).toBe('CLOSED');
  });
});

describe('the approval record', () => {
  it('hashes the content the doctor attested', async () => {
    const f = await fixture();
    const approval = await clinical.aiApprovals.approve(
      actor(f),
      f.suggestion.id,
      noteSection('SYNTHETIC attested text.'),
    );
    const row = await db.prisma.aiApproval.findFirstOrThrow({ where: { id: approval.id } });

    expect(row.approvedContentSha256).toMatch(/^[0-9a-f]{64}$/);
    // The hash is of the approved content, so a later edit of the suggestion cannot be presented as
    // the thing that was approved.
    expect(JSON.stringify(row)).not.toContain('SYNTHETIC attested text.');
  });

  it('keeps the approved text out of the audit trail', async () => {
    const f = await fixture();
    await clinical.aiApprovals.approve(actor(f), f.suggestion.id, noteSection('SYNTHETIC attested.'));

    const entries = await db.prisma.auditLog.findMany({
      where: { action: 'AI_SUGGESTION_APPROVED' },
    });
    expect(entries).toHaveLength(1);
    // The approved text lives in the record it created; a second copy in the audit trail would be
    // clinical content in a table nobody reads for care.
    expect(JSON.stringify(entries[0]!.metadata)).not.toContain('SYNTHETIC attested.');
    expect(JSON.stringify(entries[0]!.metadata)).toContain('aiApprovalId');
  });

  it('verifies as a chain, and a tampered approval breaks it', async () => {
    const f = await fixture();
    const second = await fixture();
    const first = await clinical.aiApprovals.approve(actor(f), f.suggestion.id, noteSection());
    await clinical.aiApprovals.approve(actor(second), second.suggestion.id, noteSection());

    const clean = await new VerifyAppendOnlyChains(db.prisma, [auditChainSource, aiApprovalChainSource], {
      clock: { now: () => now },
    }).run();
    expect(clean.every((chain) => chain.ok)).toBe(true);
    expect(
      clean.some((chain) => chain.checkpointKey.startsWith(AI_APPROVAL_CHAIN_PREFIX) && chain.rows > 0),
    ).toBe(true);

    // Through a direct connection: the append-only lint forbids a Prisma update here, and the tamper
    // has to come from outside the application anyway.
    const conn = await rawConnection();
    try {
      await conn.query('UPDATE ai_approvals SET attestation_version = 9 WHERE id = ?', [first.id]);
    } finally {
      await conn.end();
    }
    const tampered = await new VerifyAppendOnlyChains(db.prisma, [aiApprovalChainSource], {
      clock: { now: () => now },
    }).run({ full: true });
    const broken = tampered.find((chain) => chain.break !== undefined);
    expect(broken?.ok).toBe(false);
    expect(broken?.break?.reason).toBe('HASH_MISMATCH');
  });
});
