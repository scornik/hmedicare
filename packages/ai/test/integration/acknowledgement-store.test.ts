import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type AppError, newId } from '@hmedic/kernel';
import type { Database } from '@hmedic/database';
import { PrismaAuditPort } from '@hmedic/audit';
import { SecretEnvelope, kekFromBase64 } from '@hmedic/secrets';
import {
  ACKNOWLEDGEMENT_TEXTS,
  AICredentialSecrets,
  AICredentialStore,
  AIAcknowledgementStore,
  type AIAcknowledgementActor,
  CURRENT_ACK_TEXT_VERSION,
  acknowledgementTextSha256,
  currentAcknowledgementTexts,
  findAcknowledgementText,
} from '../../src/public';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';

/**
 * Data-use acknowledgements (AIPOL-002, ADR-017 §3).
 *
 * The policy engine treats a live acknowledgement as a hard precondition, so the cases that matter are
 * the ones where it stops being live: a superseded text version and a doctor withdrawing. Both must
 * take any credential that leaned on it out of `ACTIVE`, or the engine would read a usable credential
 * while the statement behind it had been withdrawn.
 */
let db: Database;
let acks: AIAcknowledgementStore;
let credentials: AICredentialStore;
const now = new Date('2026-10-12T00:00:00Z');
const envelope = new SecretEnvelope({
  current: kekFromBase64('test-ai-1', randomBytes(32).toString('base64')),
});

beforeAll(() => {
  db = openTestDatabase();
  const audit = new PrismaAuditPort({ now: () => now });
  acks = new AIAcknowledgementStore({
    prisma: db.prisma,
    audit,
    enabledProviderCodes: ['mock', 'mock_alt'],
    clock: { now: () => now },
  });
  credentials = new AICredentialStore({
    prisma: db.prisma,
    audit,
    secrets: new AICredentialSecrets(envelope, randomBytes(32).toString('base64')),
    enabledProviderCodes: ['mock', 'mock_alt'],
    clock: { now: () => now },
    metadata: (providerCode, tier) =>
      ['mock', 'mock_alt'].includes(providerCode)
        ? {
            providerCode,
            tier,
            dataUsePolicy: 'MAY_TRAIN_OR_REVIEW',
            productionGate: 'OPEN',
            capabilities: ['text'],
            usageRestrictions: ['SYNTHETIC_DATA_ONLY'],
          }
        : null,
  });
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await truncateAll();
});

/** A tenant with one doctor, acting for themselves. */
async function doctor(): Promise<AIAcknowledgementActor & { doctorProfileId: string }> {
  const tenantId = newId();
  const userId = newId();
  const doctorProfileId = newId();
  await db.prisma.tenant.create({
    data: {
      id: tenantId,
      name: 'AI ack fixture',
      slug: `aiack-${tenantId.slice(-8)}`,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.prisma.user.create({
    data: {
      id: userId,
      email: `${userId}@example.invalid`,
      emailNormalized: `${userId}@example.invalid`,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.prisma.tenantMembership.create({
    data: {
      id: newId(),
      tenantId,
      userId,
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
      id: doctorProfileId,
      tenantId,
      userId,
      displayName: 'Fixture doctor',
      specialties: [],
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    } as never,
  });
  return { tenantId, userId, requestId: newId(), doctorProfileId };
}

const record = (a: Awaited<ReturnType<typeof doctor>>, over: Record<string, unknown> = {}) =>
  acks.record(a, {
    doctorProfileId: a.doctorProfileId,
    providerCode: 'mock',
    tier: 'FREE',
    locale: 'en-BD',
    termsTextVersion: CURRENT_ACK_TEXT_VERSION,
    ...over,
  } as never);

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'resolved';
  } catch (e) {
    return (e as AppError).code;
  }
};

describe('acknowledgement texts', () => {
  it('ships both locales for both tiers at the current version', () => {
    const current = currentAcknowledgementTexts();
    expect(current).toHaveLength(4);
    for (const tier of ['FREE', 'PAID'] as const) {
      for (const locale of ['bn-BD', 'en-BD'] as const) {
        expect(findAcknowledgementText(CURRENT_ACK_TEXT_VERSION, tier, locale).body.length).toBeGreaterThan(
          80,
        );
      }
    }
  });

  it('hashes each locale differently, so a row says which words were read', () => {
    const en = findAcknowledgementText(CURRENT_ACK_TEXT_VERSION, 'FREE', 'en-BD');
    const bn = findAcknowledgementText(CURRENT_ACK_TEXT_VERSION, 'FREE', 'bn-BD');
    expect(acknowledgementTextSha256(en.body)).not.toBe(acknowledgementTextSha256(bn.body));
  });

  it('says plainly that a free tier may train on what is sent', () => {
    // The whole point of the free-tier text. A version that stopped saying this would be a different
    // statement wearing the same name.
    const en = findAcknowledgementText(CURRENT_ACK_TEXT_VERSION, 'FREE', 'en-BD').body;
    expect(en).toMatch(/training/i);
    expect(findAcknowledgementText(CURRENT_ACK_TEXT_VERSION, 'PAID', 'en-BD').body).toMatch(
      /does not train/i,
    );
  });

  it('refuses an unknown text', () => {
    expect(() => findAcknowledgementText('ai-terms-v0', 'FREE', 'en-BD')).toThrow(/ACK_TEXT_NOT_FOUND/);
  });
});

describe('data-use acknowledgements', () => {
  it('records the version and the hash of the text that was read', async () => {
    const a = await doctor();
    const view = await record(a);

    expect(view.termsTextVersion).toBe(CURRENT_ACK_TEXT_VERSION);
    expect(view.termsTextSha256).toBe(
      acknowledgementTextSha256(findAcknowledgementText(CURRENT_ACK_TEXT_VERSION, 'FREE', 'en-BD').body),
    );
    expect(view.acknowledgedByUserId).toBe(a.userId);
    expect(view.revokedAt).toBeNull();
  });

  it('is idempotent for the same scope and version', async () => {
    const a = await doctor();
    const first = await record(a);
    const second = await record(a);

    // Not a second row claiming a later date: one live acknowledgement per doctor, provider and tier.
    expect(second.id).toBe(first.id);
    expect(await db.prisma.aiDataUseAcknowledgement.count({ where: { tenantId: a.tenantId } })).toBe(1);
  });

  it('keeps tiers and providers apart', async () => {
    const a = await doctor();
    await record(a);
    await record(a, { tier: 'PAID' });
    await record(a, { providerCode: 'mock_alt' });

    const live = await acks.list(a, a.doctorProfileId);
    expect(live.filter((r) => r.revokedAt === null)).toHaveLength(3);
  });

  it('refuses a superseded text version', async () => {
    const a = await doctor();
    // Re-affirming replaced terms is the one thing the version exists to prevent.
    expect(await code(record(a, { termsTextVersion: 'ai-terms-v0' }))).toBe('VALIDATION_FAILED');
  });

  it('refuses a provider this deployment cannot compose', async () => {
    const a = await doctor();
    expect(await code(record(a, { providerCode: 'nope' }))).toBe('VALIDATION_FAILED');
  });

  it('refuses another doctor without the manage permission', async () => {
    const a = await doctor();
    const other = await doctor();
    // `other` is a plain doctor in their own tenant; acting on a's profile is not theirs to do.
    expect(
      await code(
        acks.record(
          { tenantId: a.tenantId, userId: other.userId, requestId: newId() },
          {
            doctorProfileId: a.doctorProfileId,
            providerCode: 'mock',
            tier: 'FREE',
            locale: 'en-BD',
            termsTextVersion: CURRENT_ACK_TEXT_VERSION,
          },
        ),
      ),
    ).toBe('FORBIDDEN');
  });

  it('withdraws an acknowledgement without deleting the record of it', async () => {
    const a = await doctor();
    const view = await record(a);

    const withdrawn = await acks.withdraw(a, view.id);

    expect(withdrawn.revokedAt).not.toBeNull();
    expect(withdrawn.revokeReason).toBe('DOCTOR_WITHDREW');
    // "This doctor agreed to v1 on this date" stays true after they withdraw.
    expect(withdrawn.termsTextVersion).toBe(CURRENT_ACK_TEXT_VERSION);
    expect(await db.prisma.aiDataUseAcknowledgement.count({ where: { id: view.id } })).toBe(1);
  });

  it('frees the live key, so the doctor can acknowledge again after withdrawing', async () => {
    const a = await doctor();
    const first = await record(a);
    await acks.withdraw(a, first.id);

    const again = await record(a);
    expect(again.id).not.toBe(first.id);
    expect(again.revokedAt).toBeNull();
  });

  it('returns a dependent credential to PENDING_VALIDATION when the acknowledgement is withdrawn', async () => {
    const a = await doctor();
    const ack = await record(a);
    const credential = await credentials.create(a, a.doctorProfileId, {
      providerCode: 'mock',
      declaredTier: 'FREE',
      billingMode: 'DOCTOR_BYOK_FREE',
      secret: 'synthetic_test_credential_0123456789',
      dataUseAckId: ack.id,
    });
    // Put it in the state the invalidation has to undo.
    await db.prisma.aiProviderCredential.update({
      where: { id: credential.id },
      data: { status: 'ACTIVE' },
    });

    await acks.withdraw(a, ack.id);

    const after = await db.prisma.aiProviderCredential.findFirstOrThrow({
      where: { id: credential.id },
    });
    // The engine must not read a usable credential while the statement behind it is withdrawn.
    expect(after.status).toBe('PENDING_VALIDATION');
  });

  it('records a revocation reason the constraint accepts', async () => {
    // `chk_ai_ack_revocation` allows only TEXT_VERSION_SUPERSEDED, DOCTOR_WITHDREW and ADMIN, and
    // requires a reason whenever `revoked_at` is set. Asserted here because the store is the only
    // writer and a fourth reason would fail at the engine rather than in review.
    const a = await doctor();
    const view = await record(a);
    const withdrawn = await acks.withdraw(a, view.id);
    expect(['TEXT_VERSION_SUPERSEDED', 'DOCTOR_WITHDREW', 'ADMIN']).toContain(withdrawn.revokeReason);
  });

  it('every shipped text carries a version the registry knows', () => {
    // Guards the registry against a text added with a typo'd version, which would be invisible until a
    // doctor could not acknowledge it.
    for (const text of ACKNOWLEDGEMENT_TEXTS) {
      expect(() => findAcknowledgementText(text.version, text.tier, text.locale)).not.toThrow();
    }
  });
});
