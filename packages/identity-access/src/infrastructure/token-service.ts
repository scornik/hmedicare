import { type CryptoKey, SignJWT, importPKCS8, importSPKI, jwtVerify, decodeProtectedHeader } from 'jose';
import { AppError, type Clock, systemClock } from '@hmedic/kernel';
import type { AccessTokenClaims, AccessTokenPort, IssuedAccessToken } from '../application/ports';

export interface TokenConfig {
  issuer: string;
  audience: string;
  ttlSeconds: number;
  signingKeyId: string;
  signingPrivateKeyPem: string;
  /** JSON map `kid → SPKI public PEM` (rotation: old keys verify, only the current key signs). */
  verificationKeysJson: string;
}

/**
 * Ed25519 (EdDSA) access JWTs (AUTH-IMPLEMENTATION §1). Claims: iss, aud, sub, sid, tv, iat, exp; `kid`
 * in the header. No tenant list, no PHI.
 */
export class JoseTokenService implements AccessTokenPort {
  private signingKey: Promise<CryptoKey>;
  private verificationKeys: Promise<Map<string, CryptoKey>>;

  constructor(
    private readonly config: TokenConfig,
    private readonly clock: Clock = systemClock,
  ) {
    this.signingKey = importPKCS8(config.signingPrivateKeyPem, 'EdDSA');
    const map = JSON.parse(config.verificationKeysJson) as Record<string, string>;
    this.verificationKeys = Promise.all(
      Object.entries(map).map(async ([kid, pem]) => [kid, await importSPKI(pem, 'EdDSA')] as const),
    ).then((entries) => new Map(entries));
  }

  async issue(claims: AccessTokenClaims): Promise<IssuedAccessToken> {
    const now = Math.floor(this.clock.now().getTime() / 1000);
    const exp = now + this.config.ttlSeconds;
    const token = await new SignJWT({ sid: claims.sessionId, tv: claims.tokenVersion })
      .setProtectedHeader({ alg: 'EdDSA', kid: this.config.signingKeyId, typ: 'JWT' })
      .setIssuer(this.config.issuer)
      .setAudience(this.config.audience)
      .setSubject(claims.userId)
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .sign(await this.signingKey);
    return { token, expiresAt: new Date(exp * 1000) };
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    try {
      const { kid, alg } = decodeProtectedHeader(token);
      if (alg !== 'EdDSA' || typeof kid !== 'string') throw new Error('header');
      const key = (await this.verificationKeys).get(kid);
      if (!key) throw new Error('kid');
      const { payload } = await jwtVerify(token, key, {
        issuer: this.config.issuer,
        audience: this.config.audience,
        algorithms: ['EdDSA'],
        currentDate: this.clock.now(),
      });
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.sid !== 'string' ||
        typeof payload.tv !== 'number'
      ) {
        throw new Error('claims');
      }
      return { userId: payload.sub, sessionId: payload.sid, tokenVersion: payload.tv };
    } catch {
      throw new AppError('UNAUTHENTICATED');
    }
  }
}
