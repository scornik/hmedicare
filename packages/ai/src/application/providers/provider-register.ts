import type { AdapterPolicyMetadata, DeclaredTier } from '../policy/effective-policy';
import type { AIProvider } from './ai-provider-port';

/**
 * The composed set of AI providers this deployment can reach (ADAPT-001, ADR-017 §5).
 *
 * Adapters are injected rather than imported here, so this package never depends on a vendor client
 * or on a test fixture. Composition decides which adapters exist, and in which environment; this only
 * answers which one serves a provider code and what its metadata says.
 *
 * `metadata` returning null is a meaningful answer, not an absence of one: a credential for a provider
 * no adapter serves cannot be classified, so it cannot be created. The credential store refuses on
 * null rather than assuming a default, because the assumed default would be the permissive one.
 */
export class AIProviderRegister {
  private readonly byCode = new Map<string, AIProvider>();

  constructor(providers: readonly AIProvider[] = []) {
    for (const provider of providers) this.register(provider);
  }

  register(provider: AIProvider): this {
    if (this.byCode.has(provider.providerCode)) {
      // Two adapters claiming one code would make which of them serves a credential depend on
      // registration order, and therefore on composition order.
      throw new Error(`duplicate AI provider code: ${provider.providerCode}`);
    }
    this.byCode.set(provider.providerCode, provider);
    return this;
  }

  get(providerCode: string): AIProvider | null {
    return this.byCode.get(providerCode) ?? null;
  }

  /** Provider codes with an adapter, for diagnostics. Not an authorization list: policy decides that. */
  codes(): readonly string[] {
    return [...this.byCode.keys()].sort();
  }

  /** The register's metadata lookup, in the shape the credential store and policy engine consume. */
  metadata = (providerCode: string, tier: DeclaredTier): AdapterPolicyMetadata | null => {
    const provider = this.byCode.get(providerCode);
    if (!provider) return null;
    const meta = provider.metadata(tier);
    // An adapter that serves the code but not this tier answers null, and null is the refusal the
    // credential store acts on.
    if (!meta) return null;
    // An adapter answering for a code or tier other than the one asked for would silently classify a
    // credential by the wrong terms, which is the one mistake this lookup must not pass on.
    if (meta.providerCode !== providerCode || meta.tier !== tier) {
      throw new Error(`AI adapter ${providerCode} returned metadata for ${meta.providerCode}/${meta.tier}`);
    }
    return meta;
  };
}
