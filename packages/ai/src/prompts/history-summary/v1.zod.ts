import { z } from 'zod';

/**
 * The Zod mirror of `history-summary/v1.schema.json` (AI-001, AI-IMPLEMENTATION §9).
 *
 * The JSON Schema is what the provider is asked to honour; this is what the server enforces, and a
 * test asserts the two agree. A provider honouring a schema is a convenience, not a guarantee.
 */
export const HISTORY_SUMMARY_V1_SCHEMA_VERSION = 'history-summary/v1';

export const HistoryItemCategory = z.enum(['condition', 'medication', 'procedure', 'investigation', 'other']);
export type HistoryItemCategory = z.infer<typeof HistoryItemCategory>;

export const HistorySummaryItem = z
  .object({
    category: HistoryItemCategory,
    text: z.string().min(1).max(1000),
    confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    /** At least one: an item nobody can trace back to the chart is not a reading aid. */
    sourceIds: z.array(z.string().min(1).max(64)).min(1).max(10),
  })
  .strict();

export const HistorySummaryOutputV1 = z
  .object({
    // Empty is valid. A patient with nothing in range should produce no items rather than filler.
    items: z.array(HistorySummaryItem).max(30),
  })
  .strict();

export type HistorySummaryOutputV1 = z.infer<typeof HistorySummaryOutputV1>;
