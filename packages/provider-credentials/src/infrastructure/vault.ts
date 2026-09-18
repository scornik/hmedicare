import { AppError, type Clock, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, isUniqueViolation, withTransaction } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import { type SecretEnvelope, last4, secretFingerprint } from '@hmedic/secrets';

export type ProviderKind = 'SMS' | 'PAYMENT';
export type CredentialStatus =
  | 'PENDING_VALIDATION'
  | 'ACTIVE'
  | 'UNVERIFIED_UNTIL_FIRST_PAYMENT'
  | 'INVALID'
  | 'SUSPENDED_BALANCE'
  | 'DISABLED'
  | 'REVOKED';

/** What any API may return about a credential (ADR-018 §6): never the secret, only its last 4. */
export interface CredentialView {
  id: string;
  tenantId: string;
  providerKind: ProviderKind;
  providerCode: string;
  status: CredentialStatus;
  secretLast4: string;
  publicIdentifier: string | null;
  senderIdStatus: string | null;
  validatedAt: string | null;
  lastErrorClass: string | null;
}

/**
 * In-process handle given to an adapter call. The plaintext bundle is decrypted lazily inside `use` and
 * never returned, logged, queued or stored (COMMUNICATION §6.1).
 */
export interface CredentialHandle {
  readonly credentialId: string;
  readonly tenantId: string;
  readonly providerCode: string;
  readonly publicIdentifier: string | null;
  use<T>(fn: (bundle: Readonly<Record<string, string>>) => Promise<T>): Promise<T>;
}

/** AAD = credentialId|tenantId|providerKind|providerCode (DATABASE-IMPLEMENTATION §3.15). */
export function credentialAad(id: string, tenantId: string, kind: string, code: string): string {
  return `${id}|${tenantId}|${kind}|${code}`;
}

const TOMBSTONE = 'revoked';

/**
 * ProviderCredentialVault (SMS-001): envelope-encrypted provider secrets per tenant. A duplicate secret
 * (same fingerprint, same provider) is rejected while a live row holds it; revocation tombstones the
 * ciphertext but keeps the fingerprint.
 */
export class ProviderCredentialVault {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly envelope: SecretEnvelope,
    private readonly fingerprintPepper: string,
    private readonly audit: PrismaAuditPort,
    private readonly clock: Clock = systemClock,
  ) {}

  private view(r: {
    id: string;
    tenantId: string;
    providerKind: string;
    providerCode: string;
    status: string;
    secretLast4: string;
    publicIdentifier: string | null;
    senderIdStatus: string | null;
    validatedAt: Date | null;
    lastErrorClass: string | null;
  }): CredentialView {
    return {
      id: r.id,
      tenantId: r.tenantId,
      providerKind: r.providerKind as ProviderKind,
      providerCode: r.providerCode,
      status: r.status as CredentialStatus,
      secretLast4: r.secretLast4,
      publicIdentifier: r.publicIdentifier,
      senderIdStatus: r.senderIdStatus,
      validatedAt: r.validatedAt?.toISOString() ?? null,
      lastErrorClass: r.lastErrorClass,
    };
  }

  async create(input: {
    tenantId: string;
    actorUserId: string | null;
    providerKind: ProviderKind;
    providerCode: string;
    environment: 'sandbox' | 'live' | 'na';
    publicIdentifier?: string | null;
    /** Secret bundle, e.g. SMS `{ apiKey }`. Validated and discarded by the caller after this call. */
    bundle: Record<string, string>;
    /** Which bundle field feeds `secret_last4` (SMS: apiKey). */
    last4Field: string;
    balanceAlertBdt?: string | null;
  }): Promise<CredentialView> {
    const secretValue = input.bundle[input.last4Field];
    if (!secretValue || secretValue.length < 8) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fieldErrors: [{ path: input.last4Field, code: 'too_small', message: 'validation.secret_length' }],
      });
    }
    const id = newId();
    const now = this.clock.now();
    const sealed = this.envelope.encrypt(
      input.bundle,
      credentialAad(id, input.tenantId, input.providerKind, input.providerCode),
    );
    try {
      return await withTransaction(this.prisma, async (tx) => {
        const row = await tx.providerCredential.create({
          data: {
            id,
            tenantId: input.tenantId,
            ownerType: 'TENANT',
            providerKind: input.providerKind,
            providerCode: input.providerCode,
            environment: input.environment,
            publicIdentifier: input.publicIdentifier ?? null,
            encryptedSecret: sealed.encryptedSecret,
            wrappedDataKey: sealed.wrappedDataKey,
            keyId: sealed.keyId,
            secretLast4: last4(secretValue),
            secretFingerprint: secretFingerprint(this.fingerprintPepper, input.bundle),
            status: 'PENDING_VALIDATION',
            senderIdStatus: input.providerKind === 'SMS' ? 'UNVERIFIED' : null,
            balanceAlertBdt: input.balanceAlertBdt ?? null,
            createdAt: now,
            updatedAt: now,
            createdByUserId: input.actorUserId,
            updatedByUserId: input.actorUserId,
          },
        });
        await this.audit.append(tx, {
          tenantId: input.tenantId,
          actorUserId: input.actorUserId,
          actorType: 'USER',
          action: `${input.providerKind}_CREDENTIAL_CREATED`,
          resourceType: 'provider_credential',
          resourceId: id,
          outcome: 'SUCCESS',
          metadata: { credentialId: id, providerCode: input.providerCode, secretLast4: row.secretLast4 },
        });
        return this.view(row);
      });
    } catch (error) {
      if (isUniqueViolation(error, 'uq_provider_credentials_live')) {
        throw new AppError('VALIDATION_FAILED', undefined, {
          fieldErrors: [
            { path: input.last4Field, code: 'duplicate', message: 'validation.credential_duplicate' },
          ],
        });
      }
      throw error;
    }
  }

  /** Resolves a usable credential for an adapter call (never for SUSPENDED/INVALID/DISABLED/REVOKED). */
  async resolveForAdapter(
    tenantId: string,
    credentialId: string,
    allowed: CredentialStatus[] = ['ACTIVE', 'PENDING_VALIDATION'],
  ): Promise<CredentialHandle> {
    const row = await this.prisma.providerCredential.findFirst({ where: { id: credentialId, tenantId } });
    if (!row || !allowed.includes(row.status as CredentialStatus)) throw new AppError('RESOURCE_NOT_FOUND');
    const envelope = this.envelope;
    const aad = credentialAad(row.id, row.tenantId, row.providerKind, row.providerCode);
    const sealed = {
      encryptedSecret: row.encryptedSecret,
      wrappedDataKey: row.wrappedDataKey,
      keyId: row.keyId,
    };
    return {
      credentialId: row.id,
      tenantId: row.tenantId,
      providerCode: row.providerCode,
      publicIdentifier: row.publicIdentifier,
      async use(fn) {
        const bundle = Object.freeze(envelope.decrypt(sealed, aad));
        return fn(bundle);
      },
    };
  }

  async setStatus(
    tenantId: string,
    credentialId: string,
    status: CredentialStatus,
    lastErrorClass: string | null,
  ): Promise<void> {
    const now = this.clock.now();
    await this.prisma.providerCredential.updateMany({
      where: { id: credentialId, tenantId, status: { not: 'REVOKED' } },
      data: {
        status,
        lastErrorClass,
        ...(status === 'ACTIVE' ? { validatedAt: now } : {}),
        updatedAt: now,
        rowVersion: { increment: 1 },
      },
    });
  }

  /** Revocation tombstones the ciphertext (unrecoverable) and keeps the fingerprint (ADR-017 pattern). */
  async revoke(tenantId: string, credentialId: string, actorUserId: string | null): Promise<CredentialView> {
    const now = this.clock.now();
    return withTransaction(this.prisma, async (tx) => {
      const row = await tx.providerCredential.findFirst({ where: { id: credentialId, tenantId } });
      if (!row) throw new AppError('RESOURCE_NOT_FOUND');
      if (row.status === 'REVOKED') throw new AppError('INVALID_TRANSITION');
      const updated = await tx.providerCredential.update({
        where: { id: credentialId },
        data: {
          status: 'REVOKED',
          encryptedSecret: TOMBSTONE,
          wrappedDataKey: TOMBSTONE,
          revokedAt: now,
          revokedByUserId: actorUserId,
          updatedAt: now,
          updatedByUserId: actorUserId,
          rowVersion: { increment: 1 },
        },
      });
      await this.audit.append(tx, {
        tenantId,
        actorUserId,
        actorType: actorUserId ? 'USER' : 'SYSTEM',
        action: `${row.providerKind}_CREDENTIAL_REVOKED`,
        resourceType: 'provider_credential',
        resourceId: credentialId,
        outcome: 'SUCCESS',
        metadata: { credentialId, providerCode: row.providerCode, secretLast4: row.secretLast4 },
      });
      return this.view(updated);
    });
  }

  async list(tenantId: string, kind: ProviderKind): Promise<CredentialView[]> {
    const rows = await this.prisma.providerCredential.findMany({
      where: { tenantId, providerKind: kind },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.view(r));
  }

  /**
   * ReencryptProviderCredentials (KEK rotation): re-wraps data keys still under a previous KEK. Bounded
   * batch; returns the number re-wrapped. Secrets are never re-encrypted in plaintext form outside memory.
   */
  async rewrapBatch(limit = 100): Promise<number> {
    const rows = await this.prisma.providerCredential.findMany({
      where: { keyId: { not: this.envelope.currentKeyId }, status: { not: 'REVOKED' } },
      take: limit,
    });
    let n = 0;
    for (const r of rows) {
      const aad = credentialAad(r.id, r.tenantId, r.providerKind, r.providerCode);
      const next = this.envelope.rewrap(
        { encryptedSecret: r.encryptedSecret, wrappedDataKey: r.wrappedDataKey, keyId: r.keyId },
        aad,
      );
      const u = await this.prisma.providerCredential.updateMany({
        where: { id: r.id, keyId: r.keyId, rowVersion: r.rowVersion },
        data: {
          wrappedDataKey: next.wrappedDataKey,
          keyId: next.keyId,
          rowVersion: { increment: 1 },
          updatedAt: this.clock.now(),
        },
      });
      n += u.count;
    }
    return n;
  }
}
