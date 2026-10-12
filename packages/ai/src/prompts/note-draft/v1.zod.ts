import { z } from 'zod';

/**
 * The Zod mirror of `note-draft/v1.schema.json` (AI-001, AI-IMPLEMENTATION §9).
 *
 * The JSON Schema is what the provider is asked to honour; this is what the server enforces. Two
 * copies exist on purpose, and a test asserts they agree: a provider honouring a schema is a
 * convenience, not a guarantee, and the only validation that protects a chart is the one that runs
 * here.
 *
 * `strict()` everywhere. An unknown field is a model inventing structure, and silently dropping it
 * would hide that; refusing the output and retrying once is the documented behaviour.
 */
export const NOTE_DRAFT_V1_SCHEMA_VERSION = 'note-draft/v1';

export const NoteSectionKey = z.enum(['chief_complaint', 'history', 'examination', 'assessment', 'plan']);
export type NoteSectionKey = z.infer<typeof NoteSectionKey>;

export const SuggestionConfidence = z.enum(['LOW', 'MEDIUM', 'HIGH']);

/** At least one, by the schema and by the database CHECK: a claim nobody can trace is not usable. */
const SourceIds = z.array(z.string().min(1).max(64)).min(1).max(10);

export const NoteSectionSuggestion = z
  .object({
    suggestionType: z.literal('NOTE_SECTION'),
    targetSection: NoteSectionKey,
    text: z.string().min(1).max(4000),
    confidence: SuggestionConfidence,
    sourceIds: SourceIds,
  })
  .strict();

export const DiagnosisSuggestion = z
  .object({
    suggestionType: z.literal('DIAGNOSIS'),
    display: z.string().min(1).max(300),
    codeSystem: z.enum(['ICD10', 'ICD11', 'SNOMEDCT']).optional(),
    code: z.string().min(1).max(32).optional(),
    certainty: z.enum(['CONFIRMED', 'PROVISIONAL', 'DIFFERENTIAL']),
    confidence: SuggestionConfidence,
    sourceIds: SourceIds,
  })
  .strict();

export const NoteDraftSuggestion = z.discriminatedUnion('suggestionType', [
  NoteSectionSuggestion,
  DiagnosisSuggestion,
]);

export const NoteDraftOutputV1 = z
  .object({
    // An empty list is valid output. A model with thin sources should return nothing rather than
    // invent something, and the draft then says so.
    suggestions: z.array(NoteDraftSuggestion).max(20),
  })
  .strict()
  /*
   * A code without the system that defines it is not a code: `J20.9` means one thing in ICD-10 and
   * something else elsewhere, and storing it unqualified would put an ambiguous code in a chart.
   *
   * Checked here rather than on the diagnosis object because a `.refine` on a member of a
   * `discriminatedUnion` is erased when the union is built, so the rule would have been silently
   * absent from the only validation that runs server-side. The JSON Schema states the same rule
   * through `dependentRequired`.
   */
  .superRefine((value, ctx) => {
    value.suggestions.forEach((suggestion, index) => {
      if (
        suggestion.suggestionType === 'DIAGNOSIS' &&
        suggestion.code !== undefined &&
        suggestion.codeSystem === undefined
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'code requires codeSystem',
          path: ['suggestions', index, 'codeSystem'],
        });
      }
    });
  });

export type NoteDraftOutputV1 = z.infer<typeof NoteDraftOutputV1>;
