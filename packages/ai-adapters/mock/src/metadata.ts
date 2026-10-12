import type { AdapterPolicyMetadata, AdapterTermsMetadata, DeclaredTier } from '@hmedic/ai';

/**
 * Mock provider metadata (ADAPT-001, AI-PROVIDER-REGISTER.md §2).
 *
 * One entry per `(providerCode, tier)`, and `provider-register.spec.ts` fails if these diverge from
 * the register's table. The register is the source of truth precisely because a classification that
 * lives only in code gets changed by whoever is editing the code.
 *
 * The two tiers are deliberately classified differently even though both are synthetic: FREE exercises
 * the `MAY_TRAIN_OR_REVIEW` path — tenant opt-in, acknowledgement, minimization, no raw media — and
 * PAID exercises `NO_TRAINING_CONTRACTUAL`. A mock that only modelled the permissive case would leave
 * the stricter path untested, and that path is the one that protects patients.
 *
 * `productionGate` stays `OPEN` on both. The mock must never be usable in production, and the register
 * says so in the same words.
 */
export const MOCK_PROVIDER_CODE = 'mock';

const BASE: AdapterTermsMetadata = {
  termsUrl: 'n/a (internal)',
  termsLastVerifiedAt: '2026-09-17',
  processingRegionNotes: 'In process; no data leaves this deployment.',
};

export function mockMetadata(tier: DeclaredTier): AdapterPolicyMetadata & AdapterTermsMetadata {
  return {
    providerCode: MOCK_PROVIDER_CODE,
    tier,
    dataUsePolicy: tier === 'FREE' ? 'MAY_TRAIN_OR_REVIEW' : 'NO_TRAINING_CONTRACTUAL',
    // Never closed. A mock credential active in production would be a model that answers nothing
    // pretending to be one that answers something.
    productionGate: 'OPEN',
    capabilities: ['text', 'json_schema', 'audio'],
    usageRestrictions: ['SYNTHETIC_DATA_ONLY'],
    ...BASE,
  };
}
