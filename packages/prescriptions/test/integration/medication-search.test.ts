import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@hmedic/kernel';
import type { Database } from '@hmedic/database';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';
import { MedicationSearchService } from '../../src/infrastructure/medication-search';

/**
 * Catalog search ranking (Stage 7, mandatory tests 15–17).
 *
 * Three claims that are easy to assert loosely and easy to get wrong: a spelling this system invented
 * must never outrank one a source published, a tenant's own prescribing history must never lift a
 * weaker match above a stronger one, and one clinic's habits must not be visible in another's results.
 *
 * Built on a tiny synthetic catalog rather than the real dataset, so each tier holds exactly one row
 * and a reordering cannot hide behind fifty thousand neighbours.
 */
let db: Database;
let search: MedicationSearchService;

const TENANT_A = '01a0e100-0000-7000-8000-00000000000a';
const TENANT_B = '01a0e100-0000-7000-8000-00000000000b';
const sha = (seed: string) => seed.padEnd(64, '0').slice(0, 64);
const now = new Date();

beforeAll(async () => {
  db = openTestDatabase();
  search = new MedicationSearchService(db.prisma);
});
afterAll(async () => {
  await db?.close();
});

async function medication(brand: string, over: Record<string, unknown> = {}) {
  const id = newId();
  await db.prisma.medication.create({
    data: {
      id,
      canonicalKey: `synthetic:${id}`,
      canonicalKeySha256: sha(id.replace(/-/g, '')),
      datasetRecordId: `syn_${id.replace(/-/g, '').slice(0, 16)}`,
      datasetVersion: 'test-v1',
      firstSeenVersion: 'test-v1',
      brandName: brand,
      brandSearchKey: brand.toLowerCase(),
      genericDisplay: 'DEMO Generic A',
      genericSetKey: 'demo generic a',
      strengthParsed: {},
      dosageForm: 'tablet',
      dosageFormRaw: [],
      manufacturerDisplay: 'DEMO Labs',
      dgdaMatch: 'NOT_CHECKED',
      reviewStatus: 'UNVERIFIED',
      sourceIds: [],
      fieldProvenance: {},
      importedAt: now,
      updatedAt: now,
      ...over,
    } as never,
  });
  return id;
}

async function alias(medicationId: string, text: string, origin: 'source' | 'generated') {
  await db.prisma.medicationAlias.create({
    data: {
      id: newId(),
      targetType: 'MEDICATION',
      medicationId,
      alias: text,
      aliasSearchKey: text.toLowerCase(),
      script: 'latin',
      kind: origin === 'source' ? 'brand_variant' : 'banglish',
      aliasOrigin: origin,
      sources: [],
      datasetVersion: 'test-v1',
      aliasIdentitySha256: sha(`${medicationId}${text}`.replace(/-/g, '')),
    },
  });
}

/** Empties only the catalog; `truncateAll` leaves global reference tables alone by design. */
async function clearCatalog() {
  await db.prisma.medicationUsageStat.deleteMany();
  await db.prisma.medicationAlias.deleteMany();
  await db.prisma.medicationGenericLink.deleteMany();
  await db.prisma.medication.deleteMany();
}

/** `medication_usage_stats.tenant_id` carries a real foreign key, so the tenants must exist. */
async function tenant(id: string, label: string) {
  await db.prisma.tenant.create({
    data: {
      id,
      name: `DEMO ${label}`,
      slug: `demo-${label}-${id.slice(-6)}`,
      practiceType: 'GROUP',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
}

beforeEach(async () => {
  await truncateAll();
  await clearCatalog();
  await tenant(TENANT_A, 'rx-search-a');
  await tenant(TENANT_B, 'rx-search-b');
});

describe('search ranking', () => {
  /** Mandatory test 15: a generated alias never outranks a source alias. */
  it('ranks a generated alias below a source alias', async () => {
    const bySource = await medication('Zylocaine');
    const byGenerated = await medication('Qumatrol');
    // Both match "velora": one because a source published that spelling, one because this system
    // produced it. The guess must lose.
    await alias(bySource, 'Velora', 'source');
    await alias(byGenerated, 'Velora', 'generated');

    const hits = await search.search({ tenantId: TENANT_A, q: 'velora' });
    expect(hits.map((h) => h.tier)).toEqual(['SOURCE_ALIAS', 'GENERATED_ALIAS']);
    expect(hits[0]?.medicationId).toBe(bySource);
  });

  /** Mandatory test 16: the tenant boost orders within a tier and never across tiers. */
  it('never lets prescribing history lift a weaker match above a stronger one', async () => {
    const exact = await medication('Velora');
    const prefix = await medication('Velora Forte');

    // The weaker match is this tenant's favourite by a wide margin.
    await db.prisma.medicationUsageStat.create({
      data: {
        tenantId: TENANT_A,
        medicationId: prefix,
        prescribedCount: 9999,
        lastPrescribedAt: now,
      },
    });

    const hits = await search.search({ tenantId: TENANT_A, q: 'velora' });
    // Exact brand still first: the boost orders inside a tier, and tiers are not negotiable.
    expect(hits[0]).toMatchObject({ medicationId: exact, tier: 'EXACT_BRAND' });
    expect(hits[1]).toMatchObject({ medicationId: prefix, tier: 'BRAND_PREFIX' });
    expect(hits[1]?.tenantUsageCount).toBe(9999);
  });

  it('orders by prescribing history inside a tier', async () => {
    const quiet = await medication('Velora Alpha');
    const favourite = await medication('Velora Zeta');
    await db.prisma.medicationUsageStat.create({
      data: { tenantId: TENANT_A, medicationId: favourite, prescribedCount: 40, lastPrescribedAt: now },
    });

    const hits = await search.search({ tenantId: TENANT_A, q: 'velora ' });
    // Alphabetically Alpha precedes Zeta; usage is what reorders them, and only within the tier.
    expect(hits.map((h) => h.medicationId)).toEqual([favourite, quiet]);
    expect(hits.every((h) => h.tier === 'BRAND_PREFIX')).toBe(true);
  });

  /** Mandatory test 17: one tenant's usage is invisible to another. */
  it("does not let tenant A's prescribing affect tenant B's results", async () => {
    const alpha = await medication('Velora Alpha');
    const zeta = await medication('Velora Zeta');
    await db.prisma.medicationUsageStat.create({
      data: { tenantId: TENANT_A, medicationId: zeta, prescribedCount: 500, lastPrescribedAt: now },
    });

    const forA = await search.search({ tenantId: TENANT_A, q: 'velora ' });
    const forB = await search.search({ tenantId: TENANT_B, q: 'velora ' });

    expect(forA.map((h) => h.medicationId)).toEqual([zeta, alpha]);
    // B sees the alphabetical order and a zero count: another clinic's habits are not theirs to read.
    expect(forB.map((h) => h.medicationId)).toEqual([alpha, zeta]);
    expect(forB.every((h) => h.tenantUsageCount === 0)).toBe(true);
  });

  it('ignores a boost older than the usage window', async () => {
    const alpha = await medication('Velora Alpha');
    const zeta = await medication('Velora Zeta');
    const longAgo = new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000);
    await db.prisma.medicationUsageStat.create({
      data: { tenantId: TENANT_A, medicationId: zeta, prescribedCount: 500, lastPrescribedAt: longAgo },
    });

    // 400 days is outside the 180-day cut-off, so the row stops boosting entirely rather than decaying
    // — the honest behaviour for a table with no per-period buckets (PRESCRIPTION-IMPLEMENTATION §2).
    const hits = await search.search({ tenantId: TENANT_A, q: 'velora ' });
    expect(hits.map((h) => h.medicationId)).toEqual([alpha, zeta]);
  });

  it('excludes inactive rows', async () => {
    await medication('Velora Alpha');
    await medication('Velora Withdrawn', { active: false, deactivatedInVersion: 'test-v2' });
    const hits = await search.search({ tenantId: TENANT_A, q: 'velora ' });
    // A prescriber must not be offered a product the catalog has withdrawn.
    expect(hits.map((h) => h.brandName)).toEqual(['Velora Alpha']);
  });
});
