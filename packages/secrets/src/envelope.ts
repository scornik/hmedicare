import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

/**
 * Envelope encryption (ADR-017 §4, ADR-018 §6; DATABASE-IMPLEMENTATION §3.15):
 * - a fresh 256-bit data key (DEK) per secret encrypts the JSON bundle with AES-256-GCM and the AAD;
 * - the DEK is wrapped with the key-encryption key (KEK) identified by `keyId`, also AES-256-GCM, with the
 *   same AAD, so a ciphertext cannot be moved to another row, tenant or provider;
 * - stored as base64 `iv.ciphertext.tag` strings. Plaintext never leaves the calling process.
 */
export interface Kek {
  id: string;
  /** Exactly 32 bytes. */
  key: Buffer;
}

export interface KekRing {
  current: Kek;
  /** Accepted for decryption during rotation (`*_KEK_PREVIOUS`). */
  previous?: Kek | undefined;
}

export interface SealedSecret {
  encryptedSecret: string;
  wrappedDataKey: string;
  keyId: string;
}

export class SecretEnvelopeError extends Error {
  constructor(reason: 'UNKNOWN_KEY' | 'DECRYPT_FAILED' | 'MALFORMED') {
    super(`secret envelope: ${reason}`);
    this.name = 'SecretEnvelopeError';
  }
}

/** Decodes a base64 KEK from configuration; refuses anything that is not exactly 32 bytes. */
export function kekFromBase64(id: string, base64: string): Kek {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) throw new Error(`KEK ${id} must be 32 random bytes, base64-encoded`);
  return { id, key };
}

function seal(key: Buffer, plaintext: Buffer, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [iv, ct, cipher.getAuthTag()].map((b) => b.toString('base64')).join('.');
}

function open(key: Buffer, sealed: string, aad: string): Buffer {
  const parts = sealed.split('.');
  if (parts.length !== 3) throw new SecretEnvelopeError('MALFORMED');
  const [iv, ct, tag] = parts.map((p) => Buffer.from(p, 'base64')) as [Buffer, Buffer, Buffer];
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new SecretEnvelopeError('DECRYPT_FAILED');
  }
}

export class SecretEnvelope {
  constructor(private readonly ring: KekRing) {}

  get currentKeyId(): string {
    return this.ring.current.id;
  }

  encrypt(bundle: Record<string, string>, aad: string): SealedSecret {
    const dek = randomBytes(32);
    try {
      return {
        encryptedSecret: seal(dek, Buffer.from(JSON.stringify(bundle), 'utf8'), aad),
        wrappedDataKey: seal(this.ring.current.key, dek, aad),
        keyId: this.ring.current.id,
      };
    } finally {
      dek.fill(0);
    }
  }

  decrypt(sealed: SealedSecret, aad: string): Record<string, string> {
    const kek =
      sealed.keyId === this.ring.current.id
        ? this.ring.current
        : sealed.keyId === this.ring.previous?.id
          ? this.ring.previous
          : null;
    if (!kek) throw new SecretEnvelopeError('UNKNOWN_KEY');
    const dek = open(kek.key, sealed.wrappedDataKey, aad);
    try {
      return JSON.parse(open(dek, sealed.encryptedSecret, aad).toString('utf8')) as Record<string, string>;
    } finally {
      dek.fill(0);
    }
  }

  /** Re-wraps the DEK under the current KEK (rotation); the secret ciphertext is unchanged. */
  rewrap(sealed: SealedSecret, aad: string): SealedSecret {
    if (sealed.keyId === this.ring.current.id) return sealed;
    const kek = sealed.keyId === this.ring.previous?.id ? this.ring.previous : null;
    if (!kek) throw new SecretEnvelopeError('UNKNOWN_KEY');
    const dek = open(kek.key, sealed.wrappedDataKey, aad);
    try {
      return {
        ...sealed,
        wrappedDataKey: seal(this.ring.current.key, dek, aad),
        keyId: this.ring.current.id,
      };
    } finally {
      dek.fill(0);
    }
  }
}

/** Duplicate detection across tenants without decrypting: HMAC over the canonical bundle. */
export function secretFingerprint(pepper: string, bundle: Record<string, string>): string {
  const canonical = JSON.stringify(
    Object.fromEntries(
      Object.keys(bundle)
        .sort()
        .map((k) => [k, bundle[k]]),
    ),
  );
  return createHmac('sha256', pepper).update(canonical).digest('hex');
}

/** Last 4 characters for display (`secretLast4`); never more. */
export function last4(value: string): string {
  return value.slice(-4);
}
