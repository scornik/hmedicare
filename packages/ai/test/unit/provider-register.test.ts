import { describe, expect, it } from 'vitest';
import type {
  AIProvider,
  AdapterPolicyMetadata,
  AdapterTermsMetadata,
  DeclaredTier,
} from '../../src/public/index';
import { AIProviderRegister } from '../../src/public/index';

/**
 * The provider register (ADAPT-001).
 *
 * What is asserted here is mostly refusal: the register's job is to answer which adapter serves a
 * provider code, and the dangerous answers are the ones it must not invent. A missing adapter is null,
 * never a default, because the default anyone would reach for is the permissive classification.
 */
const meta = (providerCode: string, tier: DeclaredTier): AdapterPolicyMetadata & AdapterTermsMetadata => ({
  providerCode,
  tier,
  dataUsePolicy: tier === 'FREE' ? 'MAY_TRAIN_OR_REVIEW' : 'NO_TRAINING_CONTRACTUAL',
  productionGate: 'OPEN',
  capabilities: ['text'],
  usageRestrictions: [],
  termsUrl: 'https://example.test/terms',
  termsLastVerifiedAt: '2026-09-17',
  processingRegionNotes: 'Test double.',
});

function stub(providerCode: string, metadata = meta): AIProvider {
  return {
    providerCode,
    metadata: (tier) => metadata(providerCode, tier),
    listModels: async () => ({ outcome: 'OK', value: [] }),
    generate: async () => ({ outcome: 'OK', value: { text: '' } }),
    validate: async () => ({ outcome: 'OK', value: {} }),
  };
}

describe('AIProviderRegister', () => {
  it('serves a registered provider and its metadata', () => {
    const register = new AIProviderRegister([stub('alpha')]);
    expect(register.get('alpha')?.providerCode).toBe('alpha');
    expect(register.metadata('alpha', 'FREE')).toMatchObject({
      providerCode: 'alpha',
      tier: 'FREE',
      dataUsePolicy: 'MAY_TRAIN_OR_REVIEW',
    });
    expect(register.metadata('alpha', 'PAID')?.dataUsePolicy).toBe('NO_TRAINING_CONTRACTUAL');
  });

  it('answers null for a code no adapter serves', () => {
    const register = new AIProviderRegister([stub('alpha')]);
    // Null rather than a default. The credential store refuses on null, which is what keeps an
    // unclassifiable provider from being configured.
    expect(register.get('beta')).toBeNull();
    expect(register.metadata('beta', 'FREE')).toBeNull();
  });

  it('serves nothing when nothing is registered', () => {
    // A production deployment with no vendor adapter composed is exactly this case.
    const register = new AIProviderRegister();
    expect(register.codes()).toEqual([]);
    expect(register.metadata('mock', 'FREE')).toBeNull();
  });

  it('refuses two adapters claiming one code', () => {
    const register = new AIProviderRegister([stub('alpha')]);
    // Otherwise which adapter serves a credential would depend on composition order.
    expect(() => register.register(stub('alpha'))).toThrow(/duplicate AI provider code: alpha/);
  });

  it('refuses metadata an adapter reports for another code or tier', () => {
    const liar = stub('alpha', (_code, tier) => meta('beta', tier));
    const register = new AIProviderRegister([liar]);
    // Passing this on would classify the credential by another provider's terms, silently.
    expect(() => register.metadata('alpha', 'FREE')).toThrow(/returned metadata for beta\/FREE/);

    const wrongTier = stub('gamma', (code) => meta(code, 'PAID'));
    expect(() => new AIProviderRegister([wrongTier]).metadata('gamma', 'FREE')).toThrow(
      /returned metadata for gamma\/PAID/,
    );
  });

  it('lists codes in a stable order', () => {
    const register = new AIProviderRegister([stub('zeta'), stub('alpha')]);
    expect(register.codes()).toEqual(['alpha', 'zeta']);
  });

  it('keeps the metadata lookup usable when detached from the register', () => {
    // Composition passes `aiProviders.metadata` as a bare function to the credential store, so it must
    // not depend on how it is called.
    const { metadata } = new AIProviderRegister([stub('alpha')]);
    expect(metadata('alpha', 'FREE')?.providerCode).toBe('alpha');
  });
});
