import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@hmedic/kernel';
import type { Database } from '@hmedic/database';
import { PrismaAuditPort } from '@hmedic/audit';
import { AIDraftStore } from '../../src/public';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';
import { chamberWithCalledSerial } from '../../../../tests/support/clinical';

/**
 * Draft review (AI-002, AI-IMPLEMENTATION §7.1–§7.2).
 *
 * Review writes nothing clinical, so the cases here are about authority and about not lying to the
 * doctor: who may decide, what a stale screen does, what a closed draft accepts, and what the record
 * says afterwards. The transitions themselves have unit tests; these are the parts that need rows.
 */
let db: Database;
let store: AIDraftStore;
const now = new Date('2026-10-13T10:00:00Z');
let clockNow = now;
let seq = 0;

beforeAll(() => {
  db = openTestDatabase();
  store = new AIDraftStore({
    prisma: db.prisma,
    audit: new PrismaAuditPort({ now: () => clockNow }),
    clock: { now: () => clockNow },
  });
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await truncateAll();
  clockNow = now;
});

/** A tenant with a reviewing doctor, an encounter, a draft and two suggestions. */
async function fixture(options: { expiresAt?: Date } = {}) {
  const base = await chamberWithCalledSerial(db.prisma, `review${++seq}`, now);
  await db.prisma.tenantMembership.create({
    data: {
      id: newId(),
      tenantId: base.tenantId,
      userId: base.userId,
      role: 'doctor',
      // The doctor role already carries `ai.review` from the matrix; nothing extra is granted here.
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
  // The job and credential a draft hangs off. Minimal: this suite is about review, and the runner
  // has its own.
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
      purpose: 'HISTORY_SUMMARY',
      status: 'SUCCEEDED',
      finishedAt: now,
      credentialId: credential.id,
      providerCode: 'mock',
      modelId: 'mock-text-1',
      declaredTier: 'FREE',
      billingMode: 'DOCTOR_BYOK_FREE',
      effectiveDataUsePolicy: 'MAY_TRAIN_OR_REVIEW',
      promptTemplateVersion: 'history-summary/v1',
      outputSchemaVersion: 'history-summary/v1',
      sourceSelection: {},
      correlationId: newId(),
      idempotencyKey: `review-${newId()}`,
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
      draftType: 'HISTORY_SUMMARY',
      status: 'READY_FOR_REVIEW',
      outputSchemaVersion: 'history-summary/v1',
      validatedOutput: { items: [] },
      expiresAt: options.expiresAt ?? new Date(now.getTime() + 72 * 3600_000),
      createdAt: now,
      updatedAt: now,
    },
  });
  const suggestions = [];
  for (const text of ['SYNTHETIC first item.', 'SYNTHETIC second item.']) {
    suggestions.push(
      await db.prisma.aiSuggestion.create({
        data: {
          id: newId(),
          tenantId: base.tenantId,
          aiDraftId: draft.id,
          suggestionType: 'HISTORY_ITEM',
          sourceRefs: [{ sourceType: 'diagnosis', sourceId: newId(), occurredAt: now.toISOString() }],
          candidate: { category: 'condition', text, confidence: 'MEDIUM' },
          confidence: 'MEDIUM',
          status: 'PENDING',
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
  }
  return { ...base, encounterId, draftId: draft.id, suggestions };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
const actor = (f: Fixture) => ({ tenantId: f.tenantId, userId: f.userId });

describe('reading a draft', () => {
  it('returns the suggestions with their source references', async () => {
    const f = await fixture();
    const draft = await store.get(actor(f), f.draftId);

    expect(draft.status).toBe('READY_FOR_REVIEW');
    expect(draft.suggestions).toHaveLength(2);
    // Resolved to records rather than the model's own labels, so a doctor can check the claim.
    expect(draft.suggestions[0]!.sourceRefs).toMatchObject([{ sourceType: 'diagnosis' }]);
  });

  it('refuses a role that does not carry ai.review', async () => {
    const f = await fixture();
    // A nurse. The doctor role carries `ai.review` from the matrix, so the permission check has to be
    // exercised with a role that does not — and a nurse reviewing AI suggestions is exactly the case
    // the matrix refuses.
    const nurseUserId = newId();
    await db.prisma.user.create({
      data: {
        id: nurseUserId,
        email: `${nurseUserId}@example.invalid`,
        emailNormalized: `${nurseUserId}@example.invalid`,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
    });
    await db.prisma.tenantMembership.create({
      data: {
        id: newId(),
        tenantId: f.tenantId,
        userId: nurseUserId,
        role: 'nurse',
        permissions: { grants: [] },
        clinicIds: [],
        chamberIds: [],
        status: 'ACTIVE',
        rolePermissionsVersion: 2,
        createdAt: now,
        updatedAt: now,
      },
    });

    await expect(store.get({ tenantId: f.tenantId, userId: nurseUserId }, f.draftId)).rejects.toThrow(
      /FORBIDDEN/,
    );
  });

  it('refuses a doctor in the same tenant who is not assigned', async () => {
    const f = await fixture();
    const otherUserId = newId();
    await db.prisma.user.create({
      data: {
        id: otherUserId,
        email: `${otherUserId}@example.invalid`,
        emailNormalized: `${otherUserId}@example.invalid`,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
    });
    await db.prisma.tenantMembership.create({
      data: {
        id: newId(),
        tenantId: f.tenantId,
        userId: otherUserId,
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
    await db.prisma.doctorProfile.create({
      data: {
        id: newId(),
        tenantId: f.tenantId,
        userId: otherUserId,
        displayName: 'Dr. unrelated',
        specialties: [],
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
    });

    // `ai.review` says what a role may do; the assignment says whose patient it is. This doctor has
    // the permission and not the patient.
    await expect(store.get({ tenantId: f.tenantId, userId: otherUserId }, f.draftId)).rejects.toThrow(
      /FORBIDDEN/,
    );
  });

  it('does not reveal that another tenant’s draft exists', async () => {
    const f = await fixture();
    const other = await fixture();
    // Not FORBIDDEN: outside the tenant the row is not found at all, which is the answer that leaks
    // nothing about whether it exists.
    await expect(store.get(actor(other), f.draftId)).rejects.toThrow(/RESOURCE_NOT_FOUND/);
  });

  it('allows a covering doctor in the same tenant', async () => {
    const f = await fixture();
    const coveringUserId = newId();
    const coveringDoctorId = newId();
    await db.prisma.user.create({
      data: {
        id: coveringUserId,
        email: `${coveringUserId}@example.invalid`,
        emailNormalized: `${coveringUserId}@example.invalid`,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
    });
    await db.prisma.tenantMembership.create({
      data: {
        id: newId(),
        tenantId: f.tenantId,
        userId: coveringUserId,
        role: 'doctor',
        permissions: { grants: ['ai.review'] },
        clinicIds: [],
        chamberIds: [],
        status: 'ACTIVE',
        rolePermissionsVersion: 2,
        createdAt: now,
        updatedAt: now,
      },
    });
    await db.prisma.doctorProfile.create({
      data: {
        id: coveringDoctorId,
        tenantId: f.tenantId,
        userId: coveringUserId,
        displayName: 'Dr. covering',
        specialties: [],
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
    });
    await db.prisma.doctorCoverage.create({
      data: {
        id: newId(),
        tenantId: f.tenantId,
        coveredDoctorProfileId: f.doctorProfileId,
        coveringDoctorProfileId: coveringDoctorId,
        startsAt: now,
        endsAt: new Date(now.getTime() + 86_400_000),
        reason: 'SYNTHETIC cover',
        grantedByUserId: f.userId,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
    });

    // A covering doctor is treating this patient today; refusing them would be refusing care.
    const draft = await store.get({ tenantId: f.tenantId, userId: coveringUserId }, f.draftId);
    expect(draft.id).toBe(f.draftId);
  });
});

describe('opening and closing', () => {
  it('opens a draft and keeps the first open time', async () => {
    const f = await fixture();
    const first = await store.open(actor(f), f.draftId);
    expect(first.status).toBe('IN_REVIEW');
    expect(first.openedAt).toBe(now.toISOString());

    clockNow = new Date(now.getTime() + 3600_000);
    const again = await store.open(actor(f), f.draftId);
    // Idempotent, and the first time a doctor looked at it is the fact worth keeping.
    expect(again.openedAt).toBe(now.toISOString());
    expect(again.rowVersion).toBe(first.rowVersion);
  });

  it('closes a draft and leaves pending suggestions pending', async () => {
    const f = await fixture();
    const closed = await store.close(actor(f), f.draftId);

    expect(closed.status).toBe('CLOSED');
    expect(closed.closedAt).toBe(now.toISOString());
    // Closing says the doctor is done looking, not that they rejected what they never read. A record
    // claiming otherwise would be a false statement about a clinician's decision.
    expect(closed.suggestions.every((suggestion) => suggestion.status === 'PENDING')).toBe(true);
  });

  it('refuses any decision once the draft is closed', async () => {
    const f = await fixture();
    await store.close(actor(f), f.draftId);

    await expect(
      store.review(actor(f), f.suggestions[0]!.id, { decision: 'ACCEPT', expectedRowVersion: 1 }),
    ).rejects.toThrow(/AI_DRAFT_CLOSED/);
    await expect(store.open(actor(f), f.draftId)).rejects.toThrow(/AI_DRAFT_CLOSED/);
  });
});

describe('reviewing a suggestion', () => {
  it('accepts one and marks the draft as being reviewed', async () => {
    const f = await fixture();
    const reviewed = await store.review(actor(f), f.suggestions[0]!.id, {
      decision: 'ACCEPT',
      expectedRowVersion: 1,
    });

    expect(reviewed).toMatchObject({ status: 'ACCEPTED', rowVersion: 2 });
    expect(reviewed.reviewedAt).toBe(now.toISOString());
    // Deciding something implies having read it, so the draft moves without a separate open.
    const draft = await store.get(actor(f), f.draftId);
    expect(draft.status).toBe('IN_REVIEW');
  });

  it('stores an edit beside the model’s own proposal', async () => {
    const f = await fixture();
    const edited = await store.review(actor(f), f.suggestions[0]!.id, {
      decision: 'EDIT',
      editedCandidate: { category: 'condition', text: 'SYNTHETIC revised by the doctor.' },
      expectedRowVersion: 1,
    });

    expect(edited.status).toBe('EDITED');
    // Both are kept: an approval records which one the doctor attested, and a reviewer later can see
    // what the model actually proposed rather than only what was kept.
    expect(JSON.stringify(edited.candidate)).toContain('SYNTHETIC first item');
    expect(JSON.stringify(edited.editedCandidate)).toContain('revised by the doctor');
  });

  it('refuses an edit with nothing edited', async () => {
    const f = await fixture();
    // An edit with no candidate is an accept wearing the wrong name, and the two mean different
    // things to the approval that follows.
    await expect(
      store.review(actor(f), f.suggestions[0]!.id, { decision: 'EDIT', expectedRowVersion: 1 }),
    ).rejects.toThrow(/VALIDATION_FAILED/);
  });

  it('refuses a decision computed from a stale screen', async () => {
    const f = await fixture();
    await store.review(actor(f), f.suggestions[0]!.id, { decision: 'ACCEPT', expectedRowVersion: 1 });
    // Two doctors covering for each other can both have the draft open; the conflict is reported
    // rather than resolved.
    await expect(
      store.review(actor(f), f.suggestions[0]!.id, { decision: 'REJECT', expectedRowVersion: 1 }),
    ).rejects.toThrow(/STALE_VERSION/);
  });

  it('clears the reviewer when a dismissal is reopened', async () => {
    const f = await fixture();
    const rejected = await store.review(actor(f), f.suggestions[0]!.id, {
      decision: 'REJECT',
      expectedRowVersion: 1,
    });
    const reopened = await store.review(actor(f), f.suggestions[0]!.id, {
      decision: 'REOPEN',
      expectedRowVersion: rejected.rowVersion,
    });

    expect(reopened.status).toBe('PENDING');
    // A suggestion waiting for the doctor again has no decision on it, and a CHECK on this table
    // refuses PENDING with a reviewer attached.
    expect(reopened.reviewedAt).toBeNull();
  });

  it('refuses a decision on an approved suggestion', async () => {
    const f = await fixture();
    await db.prisma.aiSuggestion.update({
      where: { id: f.suggestions[0]!.id },
      data: {
        status: 'APPROVED',
        reviewedAt: now,
        reviewedByDoctorProfileId: f.doctorProfileId,
      },
    });

    await expect(
      store.review(actor(f), f.suggestions[0]!.id, { decision: 'REJECT', expectedRowVersion: 1 }),
    ).rejects.toThrow(/INVALID_TRANSITION/);
  });

  it('closes the draft once every suggestion is terminal', async () => {
    const f = await fixture();
    await store.review(actor(f), f.suggestions[0]!.id, { decision: 'REJECT', expectedRowVersion: 1 });
    let draft = await store.get(actor(f), f.draftId);
    // Still open: one suggestion is waiting.
    expect(draft.status).toBe('IN_REVIEW');

    await store.review(actor(f), f.suggestions[1]!.id, { decision: 'IGNORE', expectedRowVersion: 1 });
    draft = await store.get(actor(f), f.draftId);
    // Nothing left to review, so the draft's state matches the work rather than needing a second
    // action from the doctor.
    expect(draft.status).toBe('CLOSED');
  });

  it('keeps the draft open while a suggestion is merely accepted', async () => {
    const f = await fixture();
    await store.review(actor(f), f.suggestions[0]!.id, { decision: 'ACCEPT', expectedRowVersion: 1 });
    await store.review(actor(f), f.suggestions[1]!.id, { decision: 'ACCEPT', expectedRowVersion: 1 });

    // Accepted is not terminal: the doctor said yes but has not put it in the chart.
    expect((await store.get(actor(f), f.draftId)).status).toBe('IN_REVIEW');
  });

  it('records the decision without the candidate’s text', async () => {
    const f = await fixture();
    await store.review(actor(f), f.suggestions[0]!.id, { decision: 'ACCEPT', expectedRowVersion: 1 });

    const entries = await db.prisma.auditLog.findMany({
      where: { resourceId: f.suggestions[0]!.id },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'AI_SUGGESTION_REVIEWED', actorType: 'USER' });
    // An audit row holding a suggestion's text would be a second copy of clinical content in a table
    // nobody reads for care.
    expect(JSON.stringify(entries[0]!.metadata)).not.toContain('SYNTHETIC first item');
  });
});

describe('expiry', () => {
  it('expires a draft past its deadline and leaves the suggestions alone', async () => {
    const f = await fixture({ expiresAt: new Date(now.getTime() - 1000) });

    expect(await store.expireDue()).toBe(1);
    const draft = await db.prisma.aiDraft.findFirstOrThrow({ where: { id: f.draftId } });
    expect(draft.status).toBe('EXPIRED');
    expect(draft.closedAt?.toISOString()).toBe(now.toISOString());
    // Expiry is not a retraction: the suggestions and any approvals already made are untouched.
    const suggestions = await db.prisma.aiSuggestion.findMany({ where: { aiDraftId: f.draftId } });
    expect(suggestions.every((suggestion) => suggestion.status === 'PENDING')).toBe(true);
  });

  it('leaves a draft that has not reached its deadline', async () => {
    await fixture();
    expect(await store.expireDue()).toBe(0);
  });

  it('refuses review of an expired draft', async () => {
    const f = await fixture({ expiresAt: new Date(now.getTime() - 1000) });
    await store.expireDue();

    // The suggestions are about a consultation nobody is in; a decision now would be made out of
    // context.
    await expect(
      store.review(actor(f), f.suggestions[0]!.id, { decision: 'ACCEPT', expectedRowVersion: 1 }),
    ).rejects.toThrow(/AI_DRAFT_CLOSED/);
  });

  it('is idempotent', async () => {
    const f = await fixture({ expiresAt: new Date(now.getTime() - 1000) });
    expect(await store.expireDue()).toBe(1);
    // A second pass finds nothing, so a retry after a crash does not write a second audit row.
    expect(await store.expireDue()).toBe(0);
    expect(
      await db.prisma.auditLog.count({ where: { resourceId: f.draftId, action: 'AI_DRAFT_EXPIRED' } }),
    ).toBe(1);
  });
});
