import { z } from 'zod';

const iso = z.string().datetime({ offset: true });
const sha = z.string().regex(/^[a-f0-9]{64}$/);

/** A fact exactly as extracted from one source record (no normalization). */
export const RawFactSchema = z.object({
  source_id: z.string(),
  source_url: z.string().url(),
  source_record_id: z.string().optional(),
  fetched_at: iso,
  content_hash: sha,
  brand_name: z.string().min(1),
  brand_name_bn: z.string().optional(),
  generic_names: z.array(z.string().min(1)),
  strength_raw: z.string().optional(),
  dosage_form_raw: z.string().optional(),
  route: z.string().optional(),
  manufacturer_raw: z.string().optional(),
  pack_size_raw: z.string().optional(),
  unit_price_bdt: z.number().nonnegative().optional(),
  pack_price_bdt: z.number().nonnegative().optional(),
  price_label: z.string().optional(),
  registration_number: z.string().optional(),
  therapeutic_class: z.string().max(80).optional(),
  availability: z.enum(['in_stock', 'out_of_stock']).optional(),
  monograph_available: z.boolean().default(false)
});
export type RawFact = z.infer<typeof RawFactSchema>;

export const StrengthComponentSchema = z.object({
  value: z.number(),
  unit: z.string(),
  per_value: z.number().optional(),
  per_unit: z.string().optional()
});
export type StrengthComponent = z.infer<typeof StrengthComponentSchema>;

export const GenericRefSchema = z.object({ name: z.string(), key: z.string(), salt_form: z.string().optional(), original: z.string() });

export const NormalizedFactSchema = RawFactSchema.extend({
  generics: z.array(GenericRefSchema),
  strength: z.object({ raw: z.string().optional(), components: z.array(StrengthComponentSchema), key: z.string() }),
  dosage_form: z.string(),
  manufacturer: z.object({ raw: z.string().optional(), name: z.string().optional(), key: z.string(), alias_rule: z.string().optional() }),
  pack_size: z.object({ raw: z.string().optional(), units_per_pack: z.number().optional() }),
  brand_key: z.string(),
  record_key: z.string()
});
export type NormalizedFact = z.infer<typeof NormalizedFactSchema>;

export const ProvenancedFieldSchema = z.object({
  value: z.unknown(),
  sources: z.array(z.string()),
  agreement_count: z.number().int().nonnegative(),
  alternatives: z.array(z.object({ value: z.unknown(), sources: z.array(z.string()) })).optional()
});

export const MedicationSchema = z.object({
  id: z.string(),
  record_key: z.string(),
  brand_name: ProvenancedFieldSchema,
  brand_name_bn: ProvenancedFieldSchema.optional(),
  generic_names: ProvenancedFieldSchema,
  salt_forms: z.array(z.string()),
  strength: ProvenancedFieldSchema,
  strength_parsed: z.array(StrengthComponentSchema),
  dosage_form: ProvenancedFieldSchema,
  dosage_form_raw: z.array(z.string()),
  route: ProvenancedFieldSchema.optional(),
  manufacturer: ProvenancedFieldSchema,
  pack_size: ProvenancedFieldSchema.optional(),
  registration_number: ProvenancedFieldSchema.optional(),
  therapeutic_class: ProvenancedFieldSchema.optional(),
  monograph_available: z.boolean(),
  monograph_urls: z.array(z.string()),
  dgda_match: z.enum(['MATCHED', 'NOT_FOUND', 'AMBIGUOUS', 'NOT_CHECKED']),
  source_ids: z.array(z.string()),
  source_record_count: z.number().int().positive(),
  status: z.literal('UNVERIFIED')
});
export type Medication = z.infer<typeof MedicationSchema>;

export const GenericSchema = z.object({
  id: z.string(), key: z.string(), name: z.string(),
  aliases: z.array(z.string()), salt_forms: z.array(z.string()),
  product_count: z.number().int().nonnegative(), source_ids: z.array(z.string())
});

export const ManufacturerSchema = z.object({
  id: z.string(), key: z.string(), name: z.string(),
  aliases: z.array(z.object({ raw: z.string(), rule: z.string(), sources: z.array(z.string()) })),
  product_count: z.number().int().nonnegative(), source_ids: z.array(z.string())
});

export const AliasSchema = z.object({
  alias: z.string(),
  script: z.enum(['latin', 'bengali']),
  kind: z.enum(['brand_bn', 'banglish', 'brand_variant', 'generic_variant']),
  alias_origin: z.enum(['source', 'generated']),
  target_type: z.enum(['medication', 'generic']),
  target_id: z.string(),
  sources: z.array(z.string())
});

export const PriceObservationSchema = z.object({
  medication_id: z.string(),
  record_key: z.string(),
  source_id: z.string(),
  source_url: z.string().url(),
  unit_price_bdt: z.number().nonnegative().optional(),
  pack_price_bdt: z.number().nonnegative().optional(),
  price_label: z.string().optional(),
  is_official_mrp: z.boolean(),
  observed_at: iso
});

export const ProvenanceSchema = z.object({
  medication_id: z.string(),
  source_id: z.string(),
  source_url: z.string().url(),
  source_record_id: z.string().optional(),
  fetched_at: iso,
  content_hash: sha,
  match_method: z.enum(['exact_key', 'fuzzy_auto']),
  match_score: z.number().min(0).max(1)
});

export const ConflictSchema = z.object({
  medication_id: z.string(),
  field: z.string(),
  chosen: z.unknown(),
  rule: z.string(),
  values: z.array(z.object({ value: z.unknown(), sources: z.array(z.string()) }))
});

export const ReviewItemSchema = z.object({
  type: z.enum(['fuzzy_match', 'unmapped_dosage_form']),
  score: z.number().min(0).max(1).optional(),
  detail: z.record(z.string(), z.unknown())
});

export const DATASET_FILES = {
  'medications.jsonl': MedicationSchema,
  'generics.jsonl': GenericSchema,
  'manufacturers.jsonl': ManufacturerSchema,
  'aliases.jsonl': AliasSchema,
  'prices_observed.jsonl': PriceObservationSchema,
  'provenance.jsonl': ProvenanceSchema,
  'conflicts.jsonl': ConflictSchema,
  'review_queue.jsonl': ReviewItemSchema
} as const;
