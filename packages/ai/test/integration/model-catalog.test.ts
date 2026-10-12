import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '@hmedic/database';
import { AIModelCatalogStore } from '../../src/public';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';

/**
 * The AI model catalog (ADAPT-002).
 *
 * The behaviour worth pinning is what a refresh does to rows it did not see. Deleting them would lose
 * the row a finished job still points at; leaving them live would let a picker offer a model the
 * provider has withdrawn. Deprecating, and being able to undo that, is the middle answer, and these
 * cases hold it in place.
 */
let db: Database;
let store: AIModelCatalogStore;
const now = new Date('2026-10-12T00:00:00Z');
let clockNow = now;

const model = (modelId: string, displayName = modelId) => ({
  modelId,
  displayName,
  capabilities: ['text'] as const,
});

beforeAll(() => {
  db = openTestDatabase();
  store = new AIModelCatalogStore({ prisma: db.prisma, clock: { now: () => clockNow } });
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await truncateAll();
  clockNow = now;
});

const row = (modelId: string) =>
  db.prisma.aiModelCatalogEntry.findFirstOrThrow({ where: { providerCode: 'mock', modelId } });

describe('AI model catalog', () => {
  it('adds what a provider reported', async () => {
    const result = await store.refresh('mock', [model('mock-text-1'), model('mock-audio-1')], ['FREE']);
    expect(result).toEqual({
      providerCode: 'mock',
      added: 2,
      updated: 0,
      deprecated: 0,
      restored: 0,
    });

    const listed = await store.list('mock');
    expect(listed.map((entry) => entry.modelId)).toEqual(['mock-audio-1', 'mock-text-1']);
    expect(listed[0]).toMatchObject({
      providerCode: 'mock',
      source: 'PROVIDER_API',
      tierAvailability: ['FREE'],
      deprecatedAt: null,
    });
  });

  it('updates a model the provider still lists, without a new row', async () => {
    await store.refresh('mock', [model('mock-text-1', 'Mock text 1')], ['FREE']);
    clockNow = new Date('2026-10-13T00:00:00Z');
    const result = await store.refresh('mock', [model('mock-text-1', 'Mock text one')], ['PAID']);

    expect(result).toMatchObject({ added: 0, updated: 1, deprecated: 0 });
    const after = await row('mock-text-1');
    expect(after.displayName).toBe('Mock text one');
    expect(after.tierAvailability).toEqual(['PAID']);
    expect(after.lastVerifiedAt.toISOString()).toBe(clockNow.toISOString());
    expect(after.rowVersion).toBe(2);
    expect(await db.prisma.aiModelCatalogEntry.count()).toBe(1);
  });

  it('deprecates a model the provider stopped listing, rather than deleting it', async () => {
    await store.refresh('mock', [model('mock-text-1'), model('mock-audio-1')], ['FREE']);
    clockNow = new Date('2026-10-13T00:00:00Z');
    const result = await store.refresh('mock', [model('mock-text-1')], ['FREE']);

    expect(result).toMatchObject({ updated: 1, deprecated: 1 });
    // The row stays: a finished job records the model it used, and a reviewer reading that job needs
    // the row to still exist. `deprecated_at` says the provider withdrew it, which is a different
    // statement from the row never having been there.
    const gone = await row('mock-audio-1');
    expect(gone.deprecatedAt?.toISOString()).toBe(clockNow.toISOString());
    expect((await store.list('mock')).map((entry) => entry.modelId)).toEqual(['mock-text-1']);
  });

  it('restores a model the provider lists again', async () => {
    await store.refresh('mock', [model('mock-text-1')], ['FREE']);
    await store.refresh('mock', [], ['FREE']);
    const result = await store.refresh('mock', [model('mock-text-1')], ['FREE']);

    // A provider briefly omitting a model is likelier than a withdrawal and reinstatement, and a
    // deprecation that could not be undone would make one bad response permanent.
    expect(result).toMatchObject({ restored: 1, deprecated: 0 });
    expect((await row('mock-text-1')).deprecatedAt).toBeNull();
  });

  it('never deprecates a manually configured model', async () => {
    await store.upsertManual('mock', model('mock-manual-1'), ['FREE', 'PAID'], 8192);
    const result = await store.refresh('mock', [model('mock-text-1')], ['FREE']);

    // The provider has no list endpoint for it, so a list that was never going to mention it is no
    // evidence that it is gone.
    expect(result).toMatchObject({ added: 1, deprecated: 0 });
    const manual = await row('mock-manual-1');
    expect(manual.deprecatedAt).toBeNull();
    expect(manual.source).toBe('MANUAL_CONFIG');
    expect(manual.contextTokens).toBe(8192);
  });

  it('leaves another provider’s rows alone', async () => {
    await store.refresh('mock', [model('mock-text-1')], ['FREE']);
    await store.refresh('other', [model('other-text-1')], ['PAID']);
    await store.refresh('mock', [], ['FREE']);

    expect((await store.list('other')).map((entry) => entry.modelId)).toEqual(['other-text-1']);
    expect(await store.list('mock')).toEqual([]);
  });

  it('answers whether a model may be used for a tier', async () => {
    await store.refresh('mock', [model('mock-text-1')], ['FREE']);

    expect(await store.isUsable('mock', 'mock-text-1', 'FREE')).toBe(true);
    // A FREE key cannot report what a PAID account would see, so availability is recorded for the
    // tier that asked and nothing is claimed for the other.
    expect(await store.isUsable('mock', 'mock-text-1', 'PAID')).toBe(false);
    expect(await store.isUsable('mock', 'mock-absent', 'FREE')).toBe(false);

    await store.refresh('mock', [], ['FREE']);
    // Asked immediately before a provider call, so a model deprecated since the credential was
    // configured is not sent.
    expect(await store.isUsable('mock', 'mock-text-1', 'FREE')).toBe(false);
  });

  it('lists every provider when none is named', async () => {
    await store.refresh('mock', [model('mock-text-1')], ['FREE']);
    await store.refresh('other', [model('other-text-1')], ['FREE']);
    expect((await store.list()).map((entry) => entry.providerCode)).toEqual(['mock', 'other']);
  });

  it('refuses a duplicate (provider, model) pair at the database level', async () => {
    await store.refresh('mock', [model('mock-text-1')], ['FREE']);
    // The unique index is what makes a concurrent refresh safe: two runners cannot both insert.
    await expect(
      db.prisma.aiModelCatalogEntry.create({
        data: {
          id: '01a13007-0000-7000-8000-0000000000ff',
          providerCode: 'mock',
          modelId: 'mock-text-1',
          displayName: 'Duplicate',
          capabilities: [],
          tierAvailability: [],
          lastVerifiedAt: now,
          source: 'PROVIDER_API',
          createdAt: now,
          updatedAt: now,
        },
      }),
    ).rejects.toThrow();
  });

  it('refuses a source outside the enum', async () => {
    await expect(
      db.prisma.aiModelCatalogEntry.create({
        data: {
          id: '01a13007-0000-7000-8000-0000000000fe',
          providerCode: 'mock',
          modelId: 'mock-text-9',
          displayName: 'Bad source',
          capabilities: [],
          tierAvailability: [],
          lastVerifiedAt: now,
          source: 'GUESSED',
          createdAt: now,
          updatedAt: now,
        },
      }),
    ).rejects.toThrow();
  });
});
