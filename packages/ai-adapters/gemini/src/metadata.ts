import type { AdapterPolicyMetadata, AdapterTermsMetadata, DeclaredTier } from '@hmedic/ai';

/**
 * Gemini provider metadata (ADAPT-003, AI-PROVIDER-REGISTER.md §2 and §3 `gemini`).
 *
 * Every value here is a reading of the provider's own terms on `termsLastVerifiedAt`, and
 * `provider-register.spec.ts` fails if any of them drifts from the register's table. Nothing here is
 * legal advice; these are engineering risk labels.
 *
 * The two tiers differ because Google's terms differ. On the unpaid tier Google "uses the content you
 * submit … to provide, improve, and develop Google products and services" and human reviewers may
 * read it, which is `MAY_TRAIN_OR_REVIEW` and brings the tenant opt-in, the doctor acknowledgement and
 * minimization with it. On the paid tier Google states it does not use prompts or responses to improve
 * its products, with limited abuse-monitoring retention, which is `NO_TRAINING_CONTRACTUAL`.
 *
 * `NO_CLINICAL_PRACTICE_USE` is on both tiers and is the restriction that matters most here: Google's
 * terms forbid use "in clinical practice, to provide medical advice, or in any manner that is overseen
 * by or requires clearance or approval from a medical device regulatory agency". It is surfaced in the
 * credential UI and the acknowledgement text. It does not relax any other check, and it is one reason
 * `productionGate` stays `OPEN`.
 */
export const GEMINI_PROVIDER_CODE = 'gemini';

const BASE: AdapterTermsMetadata = {
  termsUrl: 'https://ai.google.dev/gemini-api/terms',
  termsLastVerifiedAt: '2026-09-17',
  processingRegionNotes:
    'Data may be stored transiently or cached in any country where Google maintains facilities. No ' +
    'region pinning was found for AI Studio keys.',
};

export function geminiMetadata(tier: DeclaredTier): AdapterPolicyMetadata & AdapterTermsMetadata {
  return {
    providerCode: GEMINI_PROVIDER_CODE,
    tier,
    dataUsePolicy: tier === 'FREE' ? 'MAY_TRAIN_OR_REVIEW' : 'NO_TRAINING_CONTRACTUAL',
    // Open on both tiers. The legal question of AI provider use of patient data in Bangladesh is an
    // open research gate (ADR-017 §7), and the clinical-practice prohibition above is unresolved
    // independently of it. Closing the gate takes a reviewed register change, not a configuration flag.
    productionGate: 'OPEN',
    capabilities: ['text', 'json_schema'],
    usageRestrictions:
      tier === 'FREE'
        ? [
            'NO_CLINICAL_PRACTICE_USE',
            'NO_SENSITIVE_PERSONAL_DATA_FREE_TIER',
            'USERS_18_PLUS',
            'PAID_ONLY_FOR_EEA_UK_CH_END_USERS',
          ]
        : ['NO_CLINICAL_PRACTICE_USE', 'USERS_18_PLUS'],
    ...BASE,
  };
}
