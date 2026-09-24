import { AppError, type Clock, systemClock } from '@hmedic/kernel';
import type { PrismaClient } from '@hmedic/database';
import { medicationSearchKey } from '@hmedic/localization';

/**
 * Catalog search for the prescription editor (PRESCRIPTION-IMPLEMENTATION.md §2, ADR-020 §4).
 *
 * This is a **lookup**, not advice. It finds products whose names match what a doctor typed and says
 * where each match came from. It does not rank by suitability, suggest alternatives, or carry a dose,
 * a frequency or a duration — those fields start empty when an item is selected, and nothing in this
 * file is in a position to fill them.
 *
 * Six tiers, in the order the spec fixes them:
 *
 *   1. exact brand
 *   2. brand prefix
 *   3. Bangla brand prefix
 *   4. source aliases — spellings the dataset actually carried
 *   5. generic name prefix
 *   6. generated aliases — spellings this system produced, always last
 *
 * Tier 6 is last because a generated Banglish spelling is a guess about how someone might type a name,
 * and a guess must never outrank a name a source published. A medication matching in several tiers keeps
 * its best one.
 */
export const MIN_QUERY_CHARS = 2;
export const MAX_LIMIT = 20;
/** `medication_usage_stats` counts are only boosted while recent (PRESCRIPTION-IMPLEMENTATION.md §2). */
export const USAGE_WINDOW_DAYS = 180;

export const MATCH_TIERS = [
  'EXACT_BRAND',
  'BRAND_PREFIX',
  'BRAND_BN_PREFIX',
  'SOURCE_ALIAS',
  'GENERIC_PREFIX',
  'GENERATED_ALIAS',
] as const;

export type MatchTier = (typeof MATCH_TIERS)[number];

const TIER_RANK: Readonly<Record<MatchTier, number>> = {
  EXACT_BRAND: 1,
  BRAND_PREFIX: 2,
  BRAND_BN_PREFIX: 3,
  SOURCE_ALIAS: 4,
  GENERIC_PREFIX: 5,
  GENERATED_ALIAS: 6,
};

/**
 * What the editor shows beside a result, so the person choosing can see what they are choosing from.
 *
 * `reviewStatus` is `UNVERIFIED` for every row of `medicine-dataset-20260917-4`, and the editor renders
 * it as a badge rather than hiding it. A catalog nobody has clinically reviewed is still useful for
 * finding a brand name; it is not useful as an authority, and the interface has to say which it is.
 */
export interface CatalogSource {
  datasetVersion: string;
  reviewStatus: string;
  dgdaMatch: string;
  isSynthetic: boolean;
}

export interface MedicationSearchResult {
  medicationId: string;
  brandName: string;
  brandNameBn: string | null;
  genericDisplay: string;
  strengthText: string | null;
  dosageForm: string;
  /** True for the dataset's `unmapped` form, which the editor badges rather than hiding. */
  dosageFormUnmapped: boolean;
  route: string | null;
  manufacturerDisplay: string;
  tier: MatchTier;
  /** The alias or generic name that caused a tier 4, 5 or 6 match, so the editor can show why. */
  matchedOn: string | null;
  /** This tenant's recent prescribing count for the row; ordering only, never across tiers. */
  tenantUsageCount: number;
  source: CatalogSource;
}

export interface MedicationSearchQuery {
  tenantId: string;
  q: string;
  limit?: number;
}

/** One candidate before tiers are merged and ordered. */
interface Candidate {
  medicationId: string;
  tier: MatchTier;
  matchedOn: string | null;
}

const MEDICATION_FIELDS = {
  id: true,
  brandName: true,
  brandNameBn: true,
  genericDisplay: true,
  strengthText: true,
  dosageForm: true,
  route: true,
  manufacturerDisplay: true,
  datasetVersion: true,
  reviewStatus: true,
  dgdaMatch: true,
  isSynthetic: true,
} as const;

export class MedicationSearchService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clock: Clock = systemClock,
  ) {}

  /**
   * Finds catalog medications matching `q` for one tenant.
   *
   * Runs the six tiers as six indexed queries rather than one union. Each tier reads an index built for
   * it (`ix_med_brand`, `ix_med_brand_bn`, `ix_medication_aliases_search`, `ix_medication_generics_name`),
   * and keeping them separate is what makes a result able to say *which* tier it matched in — the thing
   * the editor shows and the thing the ranking tests assert. They run concurrently, so the cost is one
   * round trip's latency rather than six.
   */
  async search(query: MedicationSearchQuery): Promise<MedicationSearchResult[]> {
    const key = medicationSearchKey(query.q);
    if (key.length < MIN_QUERY_CHARS) {
      throw new AppError(
        'VALIDATION_FAILED',
        `a catalog search needs at least ${MIN_QUERY_CHARS} characters`,
      );
    }
    const limit = Math.min(Math.max(query.limit ?? MAX_LIMIT, 1), MAX_LIMIT);

    // Each tier fetches a little more than `limit`, because a medication can match in several tiers and
    // the merge keeps only its best one. Fetching exactly `limit` per tier could leave the final list
    // short after deduplication.
    const fetch = limit * 3;

    const [exact, brand, brandBn, aliases, generics] = await Promise.all([
      this.prisma.medication.findMany({
        where: { active: true, brandSearchKey: key },
        select: { id: true },
        take: fetch,
      }),
      this.prisma.medication.findMany({
        where: { active: true, brandSearchKey: { startsWith: key } },
        select: { id: true },
        take: fetch,
      }),
      this.prisma.medication.findMany({
        where: { active: true, brandBnSearchKey: { startsWith: key } },
        select: { id: true },
        take: fetch,
      }),
      this.prisma.medicationAlias.findMany({
        where: { active: true, aliasSearchKey: { startsWith: key } },
        select: {
          alias: true,
          aliasOrigin: true,
          targetType: true,
          medicationId: true,
          genericId: true,
        },
        take: fetch * 2,
      }),
      this.prisma.medicationGeneric.findMany({
        where: { active: true, nameSearchKey: { startsWith: key } },
        select: { id: true, name: true },
        take: fetch,
      }),
    ]);

    const candidates: Candidate[] = [
      ...exact.map((m) => ({ medicationId: m.id, tier: 'EXACT_BRAND' as const, matchedOn: null })),
      ...brand.map((m) => ({ medicationId: m.id, tier: 'BRAND_PREFIX' as const, matchedOn: null })),
      ...brandBn.map((m) => ({ medicationId: m.id, tier: 'BRAND_BN_PREFIX' as const, matchedOn: null })),
    ];

    // A generic-targeted alias, or a generic name, matches every active product built on that generic.
    // Collected first so all the link lookups go in one query rather than one per generic.
    const genericTiers = new Map<string, { tier: MatchTier; matchedOn: string }>();
    for (const g of generics) genericTiers.set(g.id, { tier: 'GENERIC_PREFIX', matchedOn: g.name });

    for (const a of aliases) {
      const tier: MatchTier = a.aliasOrigin === 'generated' ? 'GENERATED_ALIAS' : 'SOURCE_ALIAS';
      if (a.targetType === 'MEDICATION' && a.medicationId) {
        candidates.push({ medicationId: a.medicationId, tier, matchedOn: a.alias });
      } else if (a.targetType === 'GENERIC' && a.genericId) {
        const held = genericTiers.get(a.genericId);
        // A generic reached by a source alias outranks the same generic reached by its own name only
        // when the alias tier is better; `best` below settles it either way, but keeping the stronger
        // claim here avoids fetching the same links twice.
        if (!held || TIER_RANK[tier] < TIER_RANK[held.tier]) {
          genericTiers.set(a.genericId, { tier, matchedOn: a.alias });
        }
      }
    }

    if (genericTiers.size > 0) {
      const links = await this.prisma.medicationGenericLink.findMany({
        // No relation filter: ADR-022 keeps foreign keys explicit and Prisma relation fields out of the
        // schema, so a link to an inactive medication is dropped by the `active: true` on the row fetch
        // below rather than by a join here.
        where: { genericId: { in: [...genericTiers.keys()] } },
        select: { medicationId: true, genericId: true },
        take: fetch * 10,
      });
      for (const link of links) {
        const via = genericTiers.get(link.genericId);
        if (via) {
          candidates.push({ medicationId: link.medicationId, tier: via.tier, matchedOn: via.matchedOn });
        }
      }
    }

    const best = new Map<string, Candidate>();
    for (const c of candidates) {
      const held = best.get(c.medicationId);
      if (!held || TIER_RANK[c.tier] < TIER_RANK[held.tier]) best.set(c.medicationId, c);
    }
    if (best.size === 0) return [];

    const ids = [...best.keys()];
    const [rows, usage] = await Promise.all([
      this.prisma.medication.findMany({
        where: { id: { in: ids }, active: true },
        select: MEDICATION_FIELDS,
      }),
      // Scoped to this tenant, and only this tenant. One clinic's prescribing habits are its own; a
      // boost that leaked across tenants would be a disclosure dressed up as a convenience.
      this.prisma.medicationUsageStat.findMany({
        where: {
          tenantId: query.tenantId,
          medicationId: { in: ids },
          lastPrescribedAt: { gte: this.usageSince() },
        },
        select: { medicationId: true, prescribedCount: true },
      }),
    ]);
    const counts = new Map(usage.map((u) => [u.medicationId, u.prescribedCount]));

    const results: MedicationSearchResult[] = rows.map((row) => {
      const candidate = best.get(row.id)!;
      return {
        medicationId: row.id,
        brandName: row.brandName,
        brandNameBn: row.brandNameBn,
        genericDisplay: row.genericDisplay,
        strengthText: row.strengthText,
        dosageForm: row.dosageForm,
        dosageFormUnmapped: row.dosageForm === 'unmapped',
        route: row.route,
        manufacturerDisplay: row.manufacturerDisplay,
        tier: candidate.tier,
        matchedOn: candidate.matchedOn,
        tenantUsageCount: counts.get(row.id) ?? 0,
        source: {
          datasetVersion: row.datasetVersion,
          reviewStatus: row.reviewStatus,
          dgdaMatch: row.dgdaMatch,
          isSynthetic: row.isSynthetic,
        },
      };
    });

    // Tier first, always. The tenant boost orders rows *within* a tier and can never lift one above it:
    // that is not a cap applied to a score, it is the shape of the comparison, so there is no arithmetic
    // anyone can tune until a generated alias outranks a real brand name.
    results.sort(
      (a, b) =>
        TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
        b.tenantUsageCount - a.tenantUsageCount ||
        a.brandName.localeCompare(b.brandName),
    );
    return results.slice(0, limit);
  }

  private usageSince(): Date {
    return new Date(this.clock.now().getTime() - USAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  }

  /**
   * Records that a tenant prescribed a medication, which is what feeds the boost above.
   *
   * Called from the `PrescriptionApproved` consumer (MEDDATA-004). Approval rather than drafting: a
   * draft is a doctor thinking, and half-typed reconsidered choices should not shape what the editor
   * offers the next person.
   *
   * The count is cumulative and `lastPrescribedAt` is what bounds the window — a row untouched for more
   * than `USAGE_WINDOW_DAYS` stops boosting entirely rather than decaying. That is coarser than the
   * "count in the last 180 days" the spec describes, and it is the most the current schema can say
   * honestly; a true rolling window needs per-period buckets, which is a schema change and an owner
   * decision, not something to approximate here and present as the real thing.
   */
  async recordUsage(input: { tenantId: string; medicationIds: readonly string[]; at?: Date }): Promise<void> {
    const at = input.at ?? this.clock.now();
    const unique = [...new Set(input.medicationIds)];
    for (const medicationId of unique) {
      await this.prisma.medicationUsageStat.upsert({
        where: { tenantId_medicationId: { tenantId: input.tenantId, medicationId } },
        create: { tenantId: input.tenantId, medicationId, prescribedCount: 1, lastPrescribedAt: at },
        update: { prescribedCount: { increment: 1 }, lastPrescribedAt: at },
      });
    }
  }
}
