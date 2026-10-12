import type { AdapterPolicyMetadata, AdapterTermsMetadata, DeclaredTier } from '@hmedic/ai';

/**
 * Metadata for the providers served by one OpenAI-compatible adapter (ADAPT-004,
 * AI-PROVIDER-REGISTER.md §2 and §3).
 *
 * One wire protocol, five different sets of terms. That is the whole reason this table exists
 * separately from the adapter: the HTTP shape says nothing about whether a provider trains on what it
 * receives, and the policy engine reads only this. `provider-register.spec.ts` fails if any row drifts
 * from the register's table.
 *
 * Nothing here is legal advice; these are engineering risk labels, each with clause evidence in the
 * register's §3. Two of them are `UNKNOWN`, which the policy engine treats as `MAY_TRAIN_OR_REVIEW`:
 * an unanswered question about a provider's data use is not permission.
 *
 * `anthropic` is deliberately absent. The register carries a row for it so policy and UI can be built,
 * but its OpenAI-compatibility layer ignores `response_format` and is documented as not
 * production-ready, so this adapter does not claim to serve it. A metadata entry would make the policy
 * engine permit a credential no adapter can use.
 */
export const OPENAI_COMPATIBLE_PROVIDER_CODES = [
  'openai',
  'groq',
  'mistral',
  'openrouter',
  'deepseek',
] as const;
export type OpenAICompatibleProviderCode = (typeof OPENAI_COMPATIBLE_PROVIDER_CODES)[number];

export interface OpenAICompatibleProviderProfile {
  baseUrl: string;
  /** Per tier, because terms and capabilities differ by tier for the same provider. */
  tiers: Partial<
    Record<DeclaredTier, Pick<AdapterPolicyMetadata, 'dataUsePolicy' | 'capabilities' | 'usageRestrictions'>>
  >;
  terms: AdapterTermsMetadata;
}

const UNREVIEWED = 'USAGE_POLICY_UNREVIEWED';

export const OPENAI_COMPATIBLE_PROFILES: Record<
  OpenAICompatibleProviderCode,
  OpenAICompatibleProviderProfile
> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    tiers: {
      // "As of March 1, 2023, data sent to the OpenAI API is not used to train or improve OpenAI
      // models" unless opted in. Abuse-monitoring logs are retained for up to 30 days.
      PAID: {
        dataUsePolicy: 'NO_TRAINING_CONTRACTUAL',
        capabilities: ['text', 'json_schema'],
        usageRestrictions: [UNREVIEWED],
      },
    },
    terms: {
      termsUrl: 'https://developers.openai.com/api/docs/guides/your-data',
      termsLastVerifiedAt: '2026-09-17',
      processingRegionNotes: 'Not reviewed. Zero data retention requires prior approval by OpenAI.',
    },
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    tiers: {
      // Both tiers the same: the register records no training on either, and schema support was not
      // verified — so `json_schema` is not claimed, and a schema request is refused rather than sent
      // in the hope that it works.
      FREE: {
        dataUsePolicy: 'NO_TRAINING_CONTRACTUAL',
        capabilities: ['text'],
        usageRestrictions: [UNREVIEWED, 'JSON_SCHEMA_SUPPORT_UNVERIFIED'],
      },
      PAID: {
        dataUsePolicy: 'NO_TRAINING_CONTRACTUAL',
        capabilities: ['text'],
        usageRestrictions: [UNREVIEWED, 'JSON_SCHEMA_SUPPORT_UNVERIFIED'],
      },
    },
    terms: {
      termsUrl: 'https://console.groq.com/docs/legal/services-agreement',
      termsLastVerifiedAt: '2026-09-17',
      processingRegionNotes: 'Not reviewed.',
    },
  },
  mistral: {
    baseUrl: 'https://api.mistral.ai/v1',
    tiers: {
      // Free tier trains by default with an opt-out, which is a may-train classification however the
      // account is configured: the policy engine must not depend on a setting it cannot read.
      FREE: {
        dataUsePolicy: 'MAY_TRAIN_OR_REVIEW',
        capabilities: ['text'],
        usageRestrictions: [UNREVIEWED, 'TRAINING_ON_BY_DEFAULT_OPT_OUT'],
      },
      PAID: {
        dataUsePolicy: 'NO_TRAINING_CONTRACTUAL',
        capabilities: ['text'],
        usageRestrictions: [UNREVIEWED, 'NOT_FOR_LABS_OR_PREVIEW_MODELS'],
      },
    },
    terms: {
      termsUrl: 'https://legal.mistral.ai/terms/commercial-terms-of-service',
      termsLastVerifiedAt: '2026-09-17',
      processingRegionNotes: 'Not reviewed.',
    },
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    tiers: {
      FREE: {
        dataUsePolicy: 'MAY_TRAIN_OR_REVIEW',
        capabilities: ['text'],
        usageRestrictions: [UNREVIEWED, 'DOWNSTREAM_PROVIDER_VARIES'],
      },
      // UNKNOWN because no-training depends on an account setting this platform cannot verify. The
      // policy engine reads UNKNOWN as may-train, which is the only safe reading.
      PAID: {
        dataUsePolicy: 'UNKNOWN',
        capabilities: ['text'],
        usageRestrictions: [UNREVIEWED, 'DOWNSTREAM_PROVIDER_VARIES', 'NO_TRAINING_ONLY_VIA_ACCOUNT_SETTING'],
      },
    },
    terms: {
      termsUrl: 'https://openrouter.ai/docs/features/privacy-and-logging',
      termsLastVerifiedAt: '2026-09-17',
      processingRegionNotes: 'Varies by downstream provider; not reviewed.',
    },
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    tiers: {
      PAID: {
        dataUsePolicy: 'UNKNOWN',
        capabilities: ['text'],
        usageRestrictions: [UNREVIEWED, 'PROCESSING_IN_PRC'],
      },
    },
    terms: {
      termsUrl: 'https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html',
      termsLastVerifiedAt: '2026-09-17',
      processingRegionNotes: 'Processing in the PRC. Not reviewed.',
    },
  },
};

export function isOpenAICompatibleProviderCode(code: string): code is OpenAICompatibleProviderCode {
  return (OPENAI_COMPATIBLE_PROVIDER_CODES as readonly string[]).includes(code);
}

/**
 * Metadata for one `(providerCode, tier)`, or null where the register has no such row.
 *
 * Null rather than a default: a tier a provider's terms do not cover is a tier nobody has classified,
 * and the credential store refuses on null. Inventing a classification is exactly the failure this
 * table exists to prevent.
 */
export function openAICompatibleMetadata(
  providerCode: string,
  tier: DeclaredTier,
): (AdapterPolicyMetadata & AdapterTermsMetadata) | null {
  if (!isOpenAICompatibleProviderCode(providerCode)) return null;
  const profile = OPENAI_COMPATIBLE_PROFILES[providerCode];
  const row = profile.tiers[tier];
  if (!row) return null;
  return {
    providerCode,
    tier,
    dataUsePolicy: row.dataUsePolicy,
    // Open for every provider here. None has had a register review, and several have unanswered
    // data-use or processing-region questions (ADR-017 §7).
    productionGate: 'OPEN',
    capabilities: row.capabilities,
    usageRestrictions: row.usageRestrictions,
    ...profile.terms,
  };
}
