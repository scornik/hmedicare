import { last4, secretFingerprint, type SealedSecret, type SecretEnvelopePort } from '@hmedic/secrets';

export interface AICredentialSecretScope {
  credentialId: string;
  tenantId: string;
  doctorProfileId: string;
  providerCode: string;
}
/** Persistence-only fields. Never use this object as an HTTP response. */
export interface SealedAICredentialSecret extends SealedSecret {
  secretLast4: string;
  secretFingerprint: string;
}
export class AICredentialSecretError extends Error {
  constructor(
    readonly code: 'INVALID_SECRET' | 'INVALID_SCOPE' | 'SECRET_UNAVAILABLE' | 'PROVIDER_OPERATION_FAILED',
  ) {
    super(`AI credential: ${code}`);
    this.name = 'AICredentialSecretError';
  }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validSecret = (secret: unknown): secret is string =>
  typeof secret === 'string' && secret.length >= 16 && secret.length <= 512 && !/[^\x21-\x7e]/.test(secret);

export function aiCredentialAad(scope: AICredentialSecretScope): string {
  if (
    ![scope.credentialId, scope.tenantId, scope.doctorProfileId].every(
      (id) => id.length === 36 && uuid.test(id),
    ) ||
    !/^[a-z][a-z0-9_]{0,31}$/.test(scope.providerCode) ||
    scope.providerCode.trim() !== scope.providerCode
  )
    throw new AICredentialSecretError('INVALID_SCOPE');
  return `${scope.credentialId}|${scope.tenantId}|${scope.doctorProfileId}|${scope.providerCode}`;
}

/** Uses an AI-only KEK and fingerprint pepper supplied by the composition root. */
export class AICredentialSecrets {
  constructor(
    private readonly envelope: SecretEnvelopePort,
    private readonly fingerprintPepper: string,
  ) {
    if (Buffer.byteLength(fingerprintPepper, 'utf8') < 32)
      throw new Error('AI credential fingerprint pepper must contain at least 32 bytes');
  }

  seal(scope: AICredentialSecretScope, secret: string): SealedAICredentialSecret {
    const aad = aiCredentialAad(scope);
    if (!validSecret(secret)) throw new AICredentialSecretError('INVALID_SECRET');
    const bundle = { apiKey: secret };
    return {
      ...this.envelope.encrypt(bundle, aad),
      secretLast4: last4(secret),
      secretFingerprint: secretFingerprint(this.fingerprintPepper, bundle),
    };
  }

  /** The authorized owner resolves live status before entering this provider-only scope. */
  async use<T>(
    scope: AICredentialSecretScope,
    sealed: SealedSecret,
    providerCall: (apiKey: string) => Promise<T>,
  ): Promise<T> {
    const aad = aiCredentialAad(scope);
    let bundle: Record<string, string>;
    try {
      bundle = this.envelope.decrypt(sealed, aad);
      if (Object.keys(bundle).length !== 1 || !validSecret(bundle.apiKey))
        throw new AICredentialSecretError('SECRET_UNAVAILABLE');
    } catch {
      // Neither encryption implementation details nor provider secrets enter error payloads.
      throw new AICredentialSecretError('SECRET_UNAVAILABLE');
    }
    try {
      return await providerCall(bundle.apiKey!);
    } catch {
      // Adapters return normalized failure results; unexpected thrown errors may contain secrets.
      throw new AICredentialSecretError('PROVIDER_OPERATION_FAILED');
    } finally {
      // JS strings cannot be reliably zeroed; discard the local bundle reference after use.
      delete bundle.apiKey;
    }
  }

  rewrap(scope: AICredentialSecretScope, sealed: SealedAICredentialSecret): SealedAICredentialSecret {
    const aad = aiCredentialAad(scope);
    try {
      // Authenticate the row even when rewrap is a no-op under the current KEK.
      const bundle = this.envelope.decrypt(sealed, aad);
      if (Object.keys(bundle).length !== 1 || !validSecret(bundle.apiKey))
        throw new AICredentialSecretError('SECRET_UNAVAILABLE');
      delete bundle.apiKey;
      return {
        ...this.envelope.rewrap(sealed, aad),
        secretLast4: sealed.secretLast4,
        secretFingerprint: sealed.secretFingerprint,
      };
    } catch {
      throw new AICredentialSecretError('SECRET_UNAVAILABLE');
    }
  }
}
