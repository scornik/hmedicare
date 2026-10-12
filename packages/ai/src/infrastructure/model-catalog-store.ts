import { type Clock, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, type Tx, lockRow, withTransaction } from '@hmedic/database';
import type { AIModelDescriptor } from '../application/providers/ai-provider-port';
import type { DeclaredTier } from '../application/policy/effective-policy';

/**
 * The AI model catalog (ADAPT-002, AI-IMPLEMENTATION §2).
 *
 * Models come from here and never from a literal in business code. The reason is operational rather
 * than architectural: a vendor retires a model with weeks of notice, and a model id compiled into a
 * prompt template means the next deploy is the earliest anything can change. A catalog row can be
 * deprecated the moment a refresh stops seeing it.
 *
 * Rows are never deleted. A job records the model it used, and a reviewer reading that job six months
 * later needs the row to still exist — `deprecated_at` says the provider withdrew it, which is a
 * different statement from the row never having been there.
 *
 * The table is global. A provider's model list is a property of the provider, and one copy per tenant
 * would be the same rows repeated with no way to tell which copy was stale.
 */
export type ModelCatalogSource = 'PROVIDER_API' | 'MANUAL_CONFIG';

export interface ModelCatalogEntry {
  providerCode: string;
  modelId: string;
  displayName: string;
  capabilities: readonly string[];
  tierAvailability: readonly DeclaredTier[];
  contextTokens: number | null;
  deprecatedAt: string | null;
  lastVerifiedAt: string;
  source: ModelCatalogSource;
}

export interface CatalogRefreshResult {
  providerCode: string;
  added: number;
  updated: number;
  deprecated: number;
  restored: number;
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

type Row = Awaited<ReturnType<PrismaClient['aiModelCatalogEntry']['findFirstOrThrow']>>;
const view = (row: Row): ModelCatalogEntry => ({
  providerCode: row.providerCode,
  modelId: row.modelId,
  displayName: row.displayName,
  capabilities: asStringArray(row.capabilities),
  tierAvailability: asStringArray(row.tierAvailability) as DeclaredTier[],
  contextTokens: row.contextTokens ?? null,
  deprecatedAt: row.deprecatedAt?.toISOString() ?? null,
  lastVerifiedAt: row.lastVerifiedAt.toISOString(),
  source: row.source as ModelCatalogSource,
});

export class AIModelCatalogStore {
  private readonly clock: Clock;
  constructor(
    private readonly deps: {
      prisma: PrismaClient;
      clock?: Clock;
    },
  ) {
    this.clock = deps.clock ?? systemClock;
  }

  /** Live models for a provider, newest verification first. Deprecated rows are excluded. */
  async list(providerCode?: string): Promise<ModelCatalogEntry[]> {
    const rows = await this.deps.prisma.aiModelCatalogEntry.findMany({
      where: { deprecatedAt: null, ...(providerCode ? { providerCode } : {}) },
      orderBy: [{ providerCode: 'asc' }, { modelId: 'asc' }],
    });
    return rows.map(view);
  }

  /**
   * Whether a model may be used for a tier right now.
   *
   * Asked immediately before a provider call rather than trusted from a credential's stored list: a
   * model deprecated between the credential being configured and the job running must not be sent.
   */
  async isUsable(providerCode: string, modelId: string, tier: DeclaredTier): Promise<boolean> {
    const row = await this.deps.prisma.aiModelCatalogEntry.findFirst({
      where: { providerCode, modelId, deprecatedAt: null },
    });
    return row !== null && asStringArray(row.tierAvailability).includes(tier);
  }

  /**
   * Replaces a provider's catalog with what the provider just reported.
   *
   * A model the provider no longer lists is deprecated, not deleted. One it lists again is restored,
   * because a provider briefly omitting a model from a list response is a more likely explanation than
   * the model having been withdrawn and reinstated — and a deprecation that cannot be undone would
   * make a single bad response permanent.
   *
   * `source` separates the two ways a row can exist. `PROVIDER_API` rows are what a provider said;
   * `MANUAL_CONFIG` rows were entered because the provider has no list endpoint, and a refresh must
   * not deprecate those on the strength of a list that was never going to mention them.
   */
  async refresh(
    providerCode: string,
    models: readonly AIModelDescriptor[],
    tierAvailability: readonly DeclaredTier[],
  ): Promise<CatalogRefreshResult> {
    const now = this.clock.now();
    return withTransaction(this.deps.prisma, async (tx) => {
      // Built inside the transaction, not outside it. `withTransaction` may retry on a lock conflict,
      // and this loop consumes the map as it goes: a map drained by the first attempt would leave the
      // retry inserting rows it had already updated.
      const reported = new Map(models.map((model) => [model.modelId, model]));
      const result: CatalogRefreshResult = {
        providerCode,
        added: 0,
        updated: 0,
        deprecated: 0,
        restored: 0,
      };
      const existing = await tx.aiModelCatalogEntry.findMany({ where: { providerCode } });
      for (const row of existing) await lockRow(tx, 'ai_model_catalog', row.id);

      for (const row of existing) {
        const model = reported.get(row.modelId);
        if (model) {
          if (row.deprecatedAt !== null) result.restored += 1;
          else result.updated += 1;
          await tx.aiModelCatalogEntry.update({
            where: { id: row.id },
            data: {
              displayName: model.displayName,
              capabilities: [...model.capabilities],
              tierAvailability: [...tierAvailability],
              deprecatedAt: null,
              lastVerifiedAt: now,
              source: 'PROVIDER_API',
              updatedAt: now,
              rowVersion: { increment: 1 },
            },
          });
          reported.delete(row.modelId);
          continue;
        }
        if (row.source === 'MANUAL_CONFIG' || row.deprecatedAt !== null) continue;
        result.deprecated += 1;
        await tx.aiModelCatalogEntry.update({
          where: { id: row.id },
          data: { deprecatedAt: now, updatedAt: now, rowVersion: { increment: 1 } },
        });
      }

      for (const model of reported.values()) {
        result.added += 1;
        await this.insert(tx, providerCode, model, tierAvailability, now, 'PROVIDER_API');
      }
      return result;
    });
  }

  /** For a provider with no list endpoint. Marked `MANUAL_CONFIG` so a refresh will not retire it. */
  async upsertManual(
    providerCode: string,
    model: AIModelDescriptor,
    tierAvailability: readonly DeclaredTier[],
    contextTokens?: number,
  ): Promise<ModelCatalogEntry> {
    const now = this.clock.now();
    return withTransaction(this.deps.prisma, async (tx) => {
      const existing = await tx.aiModelCatalogEntry.findFirst({
        where: { providerCode, modelId: model.modelId },
      });
      if (!existing) {
        const row = await this.insert(
          tx,
          providerCode,
          model,
          tierAvailability,
          now,
          'MANUAL_CONFIG',
          contextTokens,
        );
        return view(row);
      }
      await lockRow(tx, 'ai_model_catalog', existing.id);
      const row = await tx.aiModelCatalogEntry.update({
        where: { id: existing.id },
        data: {
          displayName: model.displayName,
          capabilities: [...model.capabilities],
          tierAvailability: [...tierAvailability],
          ...(contextTokens !== undefined ? { contextTokens } : {}),
          deprecatedAt: null,
          lastVerifiedAt: now,
          source: 'MANUAL_CONFIG',
          updatedAt: now,
          rowVersion: { increment: 1 },
        },
      });
      return view(row);
    });
  }

  private async insert(
    tx: Tx,
    providerCode: string,
    model: AIModelDescriptor,
    tierAvailability: readonly DeclaredTier[],
    now: Date,
    source: ModelCatalogSource,
    contextTokens?: number,
  ): Promise<Row> {
    return tx.aiModelCatalogEntry.create({
      data: {
        id: newId(),
        providerCode,
        modelId: model.modelId,
        displayName: model.displayName,
        capabilities: [...model.capabilities],
        tierAvailability: [...tierAvailability],
        ...(contextTokens !== undefined ? { contextTokens } : {}),
        lastVerifiedAt: now,
        source,
        createdAt: now,
        updatedAt: now,
      },
    });
  }
}
