import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@hmedic/kernel';
import {
  GENESIS_ROW_HASH,
  type Database,
  advanceChainHead,
  lockChainHead,
  withTransaction,
} from '@hmedic/database';
import { PrismaAuditPort, VerifyAppendOnlyChains, auditChainSource, computeRowHash } from '@hmedic/audit';
import { SecretEnvelope, kekFromBase64 } from '@hmedic/secrets';
import {
  AI_APPROVAL_CHAIN_PREFIX,
  AICredentialSecrets,
  AICredentialStore,
  aiApprovalChainSource,
  approvalHashInput,
} from '../../src/public';
import { openTestDatabase, rawConnection, truncateAll } from '../../../../tests/support/db';
import { chamberWithCalledSerial } from '../../../../tests/support/clinical';

/**
 * The AI job, draft, suggestion and approval tables (AI-001, DATABASE-IMPLEMENTATION §3.13).
 *
 * The rules asserted here are the ones the database must hold whatever the code above it does. A
 * suggestion with no citation, a diagnosis claiming `ai_approved` with no approval behind it, a second
 * approval of the same suggestion version — each of those is a way a clinical record could end up
 * saying something nobody attested, and each is refused by a constraint rather than only by a check in
 * application code.
 *
 * The approval chain is verified end to end, including a tamper run, because an approval is the single
 * most consequential row this feature writes: everything before it is a draft nobody has to believe,
 * and everything after it is chart.
 */
let db: Database;
let store: AICredentialStore;
const now = new Date('2026-10-13T00:00:00Z');
const clock = { now: () => now };
let seq = 0;
const secrets = new AICredentialSecrets(
  new SecretEnvelope({ current: kekFromBase64('test-ai-1', randomBytes(32).toString('base64')) }),
  randomBytes(32).toString('base64'),
);

beforeAll(() => {
  db = openTestDatabase();
  store = new AICredentialStore({
    prisma: db.prisma,
    audit: new PrismaAuditPort({ now: () => now }),
    secrets,
    enabledProviderCodes: ['mock'],
    clock,
    metadata: (providerCode, tier) => ({
      providerCode,
      tier,
      dataUsePolicy: 'MAY_TRAIN_OR_REVIEW',
      productionGate: 'OPEN',
      capabilities: ['text'],
      usageRestrictions: ['SYNTHETIC_DATA_ONLY'],
    }),
  });
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await truncateAll();
});

/**
 * A tenant with a doctor, patient, chamber, encounter and an AI credential.
 *
 * Built on the shared clinical fixture rather than hand-rolled rows: an encounter needs a chamber and
 * a called serial to be a legitimate one, and a fixture that skipped them would be asserting against
 * a state the application cannot produce.
 */
async function fixture() {
  const base = await chamberWithCalledSerial(db.prisma, `aijobs${++seq}`, now);
  // The clinical fixture does not create a membership, and the credential store resolves the live one
  // inside its own transaction.
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
  const credential = await store.create(
    { tenantId: base.tenantId, userId: base.userId },
    base.doctorProfileId,
    {
      providerCode: 'mock',
      declaredTier: 'FREE',
      billingMode: 'DOCTOR_BYOK_FREE',
      secret: 'synthetic_test_credential_0123456789',
    },
  );
  return {
    tenantId: base.tenantId,
    userId: base.userId,
    doctorProfileId: base.doctorProfileId,
    patientId: base.patientId,
    encounterId,
    credentialId: credential.id,
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

const job = (f: Fixture, over: Record<string, unknown> = {}) =>
  db.prisma.aiJob.create({
    data: {
      id: newId(),
      tenantId: f.tenantId,
      requestedByUserId: f.userId,
      doctorProfileId: f.doctorProfileId,
      patientId: f.patientId,
      encounterId: f.encounterId,
      purpose: 'NOTE_DRAFT',
      status: 'QUEUED',
      credentialId: f.credentialId,
      providerCode: 'mock',
      modelId: 'mock-text-1',
      declaredTier: 'FREE',
      billingMode: 'DOCTOR_BYOK_FREE',
      effectiveDataUsePolicy: 'MAY_TRAIN_OR_REVIEW',
      promptTemplateVersion: 'note-draft/v1',
      outputSchemaVersion: 'note-draft/v1',
      sourceSelection: { sections: ['history'] },
      correlationId: newId(),
      idempotencyKey: `job-${newId()}`,
      createdAt: now,
      updatedAt: now,
      ...over,
    },
  });

const draft = (f: Fixture, aiJobId: string, over: Record<string, unknown> = {}) =>
  db.prisma.aiDraft.create({
    data: {
      id: newId(),
      tenantId: f.tenantId,
      aiJobId,
      encounterId: f.encounterId,
      patientId: f.patientId,
      draftType: 'NOTE_DRAFT',
      status: 'READY_FOR_REVIEW',
      outputSchemaVersion: 'note-draft/v1',
      validatedOutput: { sections: [] },
      expiresAt: new Date(now.getTime() + 72 * 3600_000),
      createdAt: now,
      updatedAt: now,
      ...over,
    },
  });

const suggestion = (f: Fixture, aiDraftId: string, over: Record<string, unknown> = {}) =>
  db.prisma.aiSuggestion.create({
    data: {
      id: newId(),
      tenantId: f.tenantId,
      aiDraftId,
      suggestionType: 'NOTE_SECTION',
      targetSection: 'history',
      sourceRefs: [{ sourceType: 'encounter', sourceId: f.encounterId, occurredAt: now.toISOString() }],
      candidate: { text: 'SYNTHETIC suggestion.' },
      confidence: 'MEDIUM',
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
      ...over,
    },
  });

describe('ai_jobs', () => {
  it('stores a queued job with no finish time', async () => {
    const f = await fixture();
    const row = await job(f);
    expect(row.status).toBe('QUEUED');
    expect(row.finishedAt).toBeNull();
  });

  it('refuses a finished status with no finish time', async () => {
    const f = await fixture();
    // Otherwise a job could read as SUCCEEDED with no record of when, which is the one thing a
    // reviewer needs.
    await expect(job(f, { status: 'SUCCEEDED' })).rejects.toThrow();
  });

  it('refuses a finish time on a job that has not finished', async () => {
    const f = await fixture();
    await expect(job(f, { status: 'RUNNING', finishedAt: now })).rejects.toThrow();
  });

  it('refuses UNKNOWN as an effective policy', async () => {
    const f = await fixture();
    // UNKNOWN is resolved to MAY_TRAIN_OR_REVIEW before a job is created. A job recording UNKNOWN
    // would be one nobody could later say was permitted.
    await expect(job(f, { effectiveDataUsePolicy: 'UNKNOWN' })).rejects.toThrow();
  });

  it('refuses a second job with the same idempotency key', async () => {
    const f = await fixture();
    const first = await job(f);
    await expect(job(f, { idempotencyKey: first.idempotencyKey })).rejects.toThrow();
  });

  it('refuses a job for another tenant’s credential', async () => {
    const f = await fixture();
    const other = await fixture();
    // The composite FK is what enforces tenant scope; an id alone would have been accepted.
    await expect(job(f, { credentialId: other.credentialId })).rejects.toThrow();
  });
});

describe('ai_drafts and ai_suggestions', () => {
  it('allows one draft per job and refuses a second', async () => {
    const f = await fixture();
    const j = await job(f);
    await draft(f, j.id);
    await expect(draft(f, j.id)).rejects.toThrow();
  });

  it('refuses a suggestion that cites nothing', async () => {
    const f = await fixture();
    const d = await draft(f, (await job(f)).id);
    // A suggestion with no citation is a claim nobody can check against the record.
    await expect(suggestion(f, d.id, { sourceRefs: [] })).rejects.toThrow();
  });

  it('refuses a reviewed status with no reviewer', async () => {
    const f = await fixture();
    const d = await draft(f, (await job(f)).id);
    await expect(suggestion(f, d.id, { status: 'ACCEPTED' })).rejects.toThrow();
  });

  it('accepts a review decision with its reviewer and time', async () => {
    const f = await fixture();
    const d = await draft(f, (await job(f)).id);
    const row = await suggestion(f, d.id, {
      status: 'ACCEPTED',
      reviewedByDoctorProfileId: f.doctorProfileId,
      reviewedAt: now,
    });
    expect(row.status).toBe('ACCEPTED');
  });

  it('refuses a closed draft with no close time', async () => {
    const f = await fixture();
    await expect(draft(f, (await job(f)).id, { status: 'CLOSED' })).rejects.toThrow();
  });
});

/** Appends an approval on the tenant's chain, as the approval transaction will. */
async function approve(f: Fixture, suggestionId: string, suggestionRowVersion: number, at = now) {
  return withTransaction(db.prisma, async (tx) => {
    const chainKey = `${AI_APPROVAL_CHAIN_PREFIX}${f.tenantId}`;
    const head = await lockChainHead(tx, chainKey, at);
    const seq = Number(head.lastSeq) + 1;
    const id = newId();
    const row = {
      id,
      tenantId: f.tenantId,
      seq,
      aiSuggestionId: suggestionId,
      suggestionRowVersion,
      approvedTarget: 'ENCOUNTER_NOTE_SECTION',
      approvedRecordType: 'encounter_note_draft',
      approvedRecordId: f.encounterId,
      approvedSection: 'history',
      reviewerDoctorProfileId: f.doctorProfileId,
      attestationVersion: 1,
      approvedContentSha256: 'a'.repeat(64),
      approvedAt: at,
    };
    // Null for the first row: the verifier anchors a full run at null.
    const prevRowHash = head.lastSeq === 0n ? null : head.lastRowHash;
    const rowHash = computeRowHash(prevRowHash, approvalHashInput(row));
    const created = await tx.aiApproval.create({ data: { ...row, prevRowHash, rowHash } });
    await advanceChainHead(tx, head, BigInt(seq), rowHash, at);
    return created;
  });
}

describe('ai_approvals', () => {
  it('refuses a second approval of the same suggestion version', async () => {
    const f = await fixture();
    const s = await suggestion(f, (await draft(f, (await job(f)).id)).id);
    await approve(f, s.id, s.rowVersion);
    // The unique is what makes double approval impossible even if two requests race.
    await expect(approve(f, s.id, s.rowVersion)).rejects.toThrow();
  });

  it('allows a later version of the same suggestion', async () => {
    const f = await fixture();
    const s = await suggestion(f, (await draft(f, (await job(f)).id)).id);
    await approve(f, s.id, s.rowVersion);
    const second = await approve(f, s.id, s.rowVersion + 1);
    expect(second.seq).toBe(2);
  });

  it('refuses a note-section approval with no section', async () => {
    const f = await fixture();
    const s = await suggestion(f, (await draft(f, (await job(f)).id)).id);
    await expect(
      db.prisma.aiApproval.create({
        data: {
          id: newId(),
          tenantId: f.tenantId,
          seq: 1,
          aiSuggestionId: s.id,
          suggestionRowVersion: s.rowVersion,
          approvedTarget: 'ENCOUNTER_NOTE_SECTION',
          approvedRecordType: 'encounter_note_draft',
          approvedRecordId: f.encounterId,
          reviewerDoctorProfileId: f.doctorProfileId,
          attestationVersion: 1,
          approvedContentSha256: 'a'.repeat(64),
          approvedAt: now,
          rowHash: 'b'.repeat(64),
        },
      }),
    ).rejects.toThrow();
  });

  it.each(['PRESCRIPTION_ITEM', 'FOLLOW_UP'])('refuses the V1+ target %s', async (approvedTarget) => {
    const f = await fixture();
    const s = await suggestion(f, (await draft(f, (await job(f)).id)).id);
    // The API refuses these too; the CHECK stops a future bug writing an approval for a target
    // nothing executes.
    await expect(
      db.prisma.aiApproval.create({
        data: {
          id: newId(),
          tenantId: f.tenantId,
          seq: 1,
          aiSuggestionId: s.id,
          suggestionRowVersion: s.rowVersion,
          approvedTarget,
          approvedRecordType: 'prescription_item',
          approvedRecordId: newId(),
          reviewerDoctorProfileId: f.doctorProfileId,
          attestationVersion: 1,
          approvedContentSha256: 'a'.repeat(64),
          approvedAt: now,
          rowHash: 'b'.repeat(64),
        },
      }),
    ).rejects.toThrow();
  });

  it('verifies as a chain, and a tampered row breaks it', async () => {
    const f = await fixture();
    const d = await draft(f, (await job(f)).id);
    const first = await suggestion(f, d.id);
    const second = await suggestion(f, d.id);
    await approve(f, first.id, first.rowVersion);
    const tampered = await approve(f, second.id, second.rowVersion, new Date(now.getTime() + 1000));

    const verifier = new VerifyAppendOnlyChains(db.prisma, [auditChainSource, aiApprovalChainSource], {
      clock: { now: () => now },
    });
    const clean = await verifier.run();
    expect(clean.every((c) => c.ok)).toBe(true);
    // The approval chain was actually walked, rather than the assertion passing on an empty list.
    expect(clean.some((c) => c.checkpointKey.startsWith(AI_APPROVAL_CHAIN_PREFIX) && c.rows > 0)).toBe(true);

    // Edited through raw SQL on purpose: the append-only lint forbids a Prisma update here, and that
    // is the rule this test is proving the database backs up.
    const conn = await rawConnection();
    try {
      await conn.query('UPDATE ai_approvals SET attestation_version = 9 WHERE id = ?', [tampered.id]);
    } finally {
      await conn.end();
    }
    // `full`, not an incremental run: the clean verification above advanced this chain's checkpoint,
    // so a default run would start past the edited row and report a chain it never looked at.
    const after = await new VerifyAppendOnlyChains(db.prisma, [aiApprovalChainSource], {
      clock: { now: () => now },
    }).run({ full: true });
    const chain = after.find((c) => c.checkpointKey.startsWith(AI_APPROVAL_CHAIN_PREFIX));
    expect(chain?.ok).toBe(false);
    expect(chain?.break?.seq).toBe(2n);
    expect(chain?.break?.reason).toBe('HASH_MISMATCH');
    // A full run re-anchors at the genesis hash, which is what lets the first row be checked too.
    expect(GENESIS_ROW_HASH).toHaveLength(64);
  });
});

describe('diagnoses linked to an approval', () => {
  it('refuses source=ai_approved with no approval behind it', async () => {
    const f = await fixture();
    // This is what makes the label verifiable rather than something any code path could claim.
    await expect(
      db.prisma.diagnosis.create({
        data: {
          id: newId(),
          tenantId: f.tenantId,
          encounterId: f.encounterId,
          patientId: f.patientId,
          authorDoctorProfileId: f.doctorProfileId,
          display: 'SYNTHETIC diagnosis',
          clinicalStatus: 'ACTIVE',
          certainty: 'CONFIRMED',
          source: 'ai_approved',
          createdAt: now,
          updatedAt: now,
        },
      }),
    ).rejects.toThrow();
  });

  it('refuses an approval id on a doctor-entered diagnosis', async () => {
    const f = await fixture();
    const s = await suggestion(f, (await draft(f, (await job(f)).id)).id);
    const approval = await approve(f, s.id, s.rowVersion);
    await expect(
      db.prisma.diagnosis.create({
        data: {
          id: newId(),
          tenantId: f.tenantId,
          encounterId: f.encounterId,
          patientId: f.patientId,
          authorDoctorProfileId: f.doctorProfileId,
          display: 'SYNTHETIC diagnosis',
          clinicalStatus: 'ACTIVE',
          certainty: 'CONFIRMED',
          source: 'doctor',
          aiApprovalId: approval.id,
          createdAt: now,
          updatedAt: now,
        },
      }),
    ).rejects.toThrow();
  });

  it('accepts an AI-approved diagnosis that names its approval', async () => {
    const f = await fixture();
    const s = await suggestion(f, (await draft(f, (await job(f)).id)).id);
    const approval = await approve(f, s.id, s.rowVersion);
    const row = await db.prisma.diagnosis.create({
      data: {
        id: newId(),
        tenantId: f.tenantId,
        encounterId: f.encounterId,
        patientId: f.patientId,
        authorDoctorProfileId: f.doctorProfileId,
        display: 'SYNTHETIC diagnosis',
        clinicalStatus: 'ACTIVE',
        certainty: 'CONFIRMED',
        source: 'ai_approved',
        aiApprovalId: approval.id,
        createdAt: now,
        updatedAt: now,
      },
    });
    expect(row.aiApprovalId).toBe(approval.id);
  });
});

describe('ai_usage_counters and ai_usage_ledger', () => {
  it('keys a counter by credential, window and window start', async () => {
    const f = await fixture();
    const windowStart = new Date('2026-10-13T00:00:00Z');
    await db.prisma.aiUsageCounter.create({
      data: {
        credentialId: f.credentialId,
        tenantId: f.tenantId,
        window: 'DAY',
        windowStart,
        requestCount: 1,
        inputTokens: 100n,
        outputTokens: 20n,
        updatedAt: now,
      },
    });
    await expect(
      db.prisma.aiUsageCounter.create({
        data: {
          credentialId: f.credentialId,
          tenantId: f.tenantId,
          window: 'DAY',
          windowStart,
          updatedAt: now,
        },
      }),
    ).rejects.toThrow();
    // A different window of the same credential is a different row, which is what makes the minute
    // and day counters independent.
    const minute = await db.prisma.aiUsageCounter.create({
      data: {
        credentialId: f.credentialId,
        tenantId: f.tenantId,
        window: 'MINUTE',
        windowStart,
        updatedAt: now,
      },
    });
    expect(minute.window).toBe('MINUTE');
  });

  it('refuses a window outside the enum', async () => {
    const f = await fixture();
    await expect(
      db.prisma.aiUsageCounter.create({
        data: {
          credentialId: f.credentialId,
          tenantId: f.tenantId,
          window: 'HOUR',
          windowStart: now,
          updatedAt: now,
        },
      }),
    ).rejects.toThrow();
  });

  it('records a ledger row per provider call', async () => {
    const f = await fixture();
    const j = await job(f);
    const row = await db.prisma.aiUsageLedgerEntry.create({
      data: {
        id: newId(),
        tenantId: f.tenantId,
        jobId: j.id,
        credentialId: f.credentialId,
        doctorProfileId: f.doctorProfileId,
        providerCode: 'mock',
        modelId: 'mock-text-1',
        billingMode: 'DOCTOR_BYOK_FREE',
        inputTokens: 100,
        outputTokens: 20,
        outcome: 'SUCCESS',
        occurredAt: now,
      },
    });
    expect(row.outcome).toBe('SUCCESS');
    // The provider's own request id is hashed where it is kept at all: it identifies the call in the
    // provider's system.
    expect(row.providerRequestIdHash).toBeNull();
  });

  it('refuses a ledger outcome outside the enum', async () => {
    const f = await fixture();
    const j = await job(f);
    await expect(
      db.prisma.aiUsageLedgerEntry.create({
        data: {
          id: newId(),
          tenantId: f.tenantId,
          jobId: j.id,
          credentialId: f.credentialId,
          doctorProfileId: f.doctorProfileId,
          providerCode: 'mock',
          modelId: 'mock-text-1',
          billingMode: 'DOCTOR_BYOK_FREE',
          outcome: 'MAYBE',
          occurredAt: now,
        },
      }),
    ).rejects.toThrow();
  });
});
