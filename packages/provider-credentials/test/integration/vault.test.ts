import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateSecret } from '@hmedic/config/testing';
import { newId } from '@hmedic/kernel';
import type { Database } from '@hmedic/database';
import { PrismaAuditPort } from '@hmedic/audit';
import { SecretEnvelope, kekFromBase64 } from '@hmedic/secrets';
import { ProviderCredentialVault } from '../../src/public/index';
import { openTestDatabase, rawConnection, truncateAll } from '../../../../tests/support/db';

// SMS-001 ProviderCredentialVault: encryption at rest, AAD binding, duplicates, tombstone, KEK rotation.
let db: Database;
const kek1 = kekFromBase64('test-pc-1', randomBytes(32).toString('base64'));
const kek2 = kekFromBase64('test-pc-2', randomBytes(32).toString('base64'));
const pepper = generateSecret();
const KEY = 'zit_fake_0123456789abcdef0123456789abcdef';
let vault: ProviderCredentialVault;

beforeAll(() => {
  db = openTestDatabase();
  vault = new ProviderCredentialVault(
    db.prisma,
    new SecretEnvelope({ current: kek1 }),
    pepper,
    new PrismaAuditPort(),
  );
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await truncateAll();
});

async function tenant(): Promise<string> {
  const id = newId();
  const now = new Date();
  await db.prisma.tenant.create({
    data: {
      id,
      name: 'DEMO',
      slug: `demo-${id.slice(-8)}`,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  return id;
}

const create = (tenantId: string, apiKey = KEY) =>
  vault.create({
    tenantId,
    actorUserId: null,
    providerKind: 'SMS',
    providerCode: 'zamanit',
    environment: 'na',
    publicIdentifier: 'DEMO',
    bundle: { apiKey },
    last4Field: 'apiKey',
  });

describe('ProviderCredentialVault', () => {
  it('stores only ciphertext and last 4; the handle decrypts in-process', async () => {
    const t = await tenant();
    const view = await create(t);
    expect(view).toMatchObject({
      status: 'PENDING_VALIDATION',
      secretLast4: 'cdef',
      senderIdStatus: 'UNVERIFIED',
    });
    expect(JSON.stringify(view)).not.toContain(KEY);
    const row = await db.prisma.providerCredential.findUniqueOrThrow({ where: { id: view.id } });
    expect(JSON.stringify(row)).not.toContain(KEY);
    const handle = await vault.resolveForAdapter(t, view.id);
    expect(await handle.use(async (b) => b.apiKey === KEY)).toBe(true);
    expect(JSON.stringify(handle)).not.toContain(KEY);
    const audit = await db.prisma.auditLog.findFirstOrThrow({ where: { action: 'SMS_CREDENTIAL_CREATED' } });
    expect(JSON.stringify(audit.metadata)).not.toContain(KEY);
  });

  it('binds ciphertext to the row: copying a secret to another row fails to decrypt (AAD)', async () => {
    const t = await tenant();
    const a = await create(t);
    const b = await create(t, 'zit_fake_ffffffffffffffffffffffffffffffff');
    const c = await rawConnection();
    try {
      await c.query(
        'UPDATE provider_credentials b JOIN provider_credentials a ON a.id = ? SET b.encrypted_secret = a.encrypted_secret, b.wrapped_data_key = a.wrapped_data_key WHERE b.id = ?',
        [a.id, b.id],
      );
    } finally {
      await c.end();
    }
    const handle = await vault.resolveForAdapter(t, b.id);
    await expect(handle.use(async (x) => x.apiKey)).rejects.toThrow(/DECRYPT_FAILED/);
  });

  it('rejects a duplicate live secret per tenant; revocation tombstones it and allows re-adding', async () => {
    const t = await tenant();
    const first = await create(t);
    await expect(create(t)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(create(await tenant())).resolves.toBeTruthy(); // another tenant's own account
    const revoked = await vault.revoke(t, first.id, null);
    expect(revoked.status).toBe('REVOKED');
    const row = await db.prisma.providerCredential.findUniqueOrThrow({ where: { id: first.id } });
    expect(row.encryptedSecret).toBe('revoked');
    expect(row.secretFingerprint).toMatch(/^[0-9a-f]{64}$/);
    await expect(vault.resolveForAdapter(t, first.id)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(create(t)).resolves.toMatchObject({ status: 'PENDING_VALIDATION' });
  });

  it('never resolves suspended/invalid credentials and isolates tenants', async () => {
    const t = await tenant();
    const v = await create(t);
    await vault.setStatus(t, v.id, 'SUSPENDED_BALANCE', 'INSUFFICIENT_BALANCE');
    await expect(vault.resolveForAdapter(t, v.id)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await vault.setStatus(t, v.id, 'ACTIVE', null);
    await expect(vault.resolveForAdapter(await tenant(), v.id)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('re-wraps data keys after KEK rotation (ReencryptProviderCredentials)', async () => {
    const t = await tenant();
    const v = await create(t);
    const rotated = new ProviderCredentialVault(
      db.prisma,
      new SecretEnvelope({ current: kek2, previous: kek1 }),
      pepper,
      new PrismaAuditPort(),
    );
    expect(await rotated.rewrapBatch()).toBe(1);
    expect((await db.prisma.providerCredential.findUniqueOrThrow({ where: { id: v.id } })).keyId).toBe(
      'test-pc-2',
    );
    const onlyNew = new ProviderCredentialVault(
      db.prisma,
      new SecretEnvelope({ current: kek2 }),
      pepper,
      new PrismaAuditPort(),
    );
    expect(await (await onlyNew.resolveForAdapter(t, v.id)).use(async (b) => b.apiKey)).toBe(KEY);
    expect(await rotated.rewrapBatch()).toBe(0);
  });
});
