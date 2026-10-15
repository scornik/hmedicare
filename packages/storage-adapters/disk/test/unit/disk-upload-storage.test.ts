import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildStorageKey,
  uploadPartSize,
  assertUploadParts,
  type UploadPartReceipt,
  type UploadStorageSession,
} from '@hmedic/laboratory-documents';
import { DiskUploadStorage } from '../../src/index';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const roots: string[] = [];
afterEach(async () => {
  // Each root comes exclusively from this test's mkdtemp call.
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(bytes = Buffer.from('abcdefghi'), partSizeBytes = 4) {
  const root = await mkdtemp(path.join(tmpdir(), 'hmedic-upload-test-'));
  roots.push(root);
  let now = new Date('2026-10-15T10:00:00Z');
  const storage = new DiskUploadStorage({ root }, () => now);
  const session: UploadStorageSession = {
    sessionId: randomUUID(),
    key: buildStorageKey({
      tenantId: randomUUID(),
      documentId: randomUUID(),
      category: 'LAB_REPORT',
      revision: 1,
    }),
    contentType: 'application/pdf',
    sizeBytes: bytes.length,
    sha256: hash(bytes),
    partSizeBytes,
    expiresAt: new Date(now.getTime() + 60_000),
  };
  await storage.createUploadSession(session);
  return {
    root,
    storage,
    session,
    bytes,
    expire: () => {
      now = new Date(session.expiresAt);
    },
  };
}
async function parts(f: Awaited<ReturnType<typeof fixture>>, storage = f.storage) {
  const receipts: UploadPartReceipt[] = [];
  for (let number = 1; number <= Math.ceil(f.bytes.length / f.session.partSizeBytes); number++) {
    const start = (number - 1) * f.session.partSizeBytes;
    const bytes = f.bytes.subarray(start, start + f.session.partSizeBytes);
    receipts.push(await storage.uploadPart(f.session, number, Readable.from([bytes]), hash(bytes)));
  }
  return receipts;
}
async function read(storage: DiskUploadStorage, key: string) {
  const { stream } = await storage.get(key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

describe('resumable private disk uploads', () => {
  it('resumes after a new adapter instance and recovers a lost finalize response without overwriting', async () => {
    const f = await fixture();
    await f.storage.createUploadSession(f.session);
    const restarted = new DiskUploadStorage({ root: f.root }, () => new Date('2026-10-15T10:00:01Z'));
    const receipts = await parts(f, restarted);
    const expected = { key: f.session.key, sizeBytes: f.bytes.length, sha256: hash(f.bytes) };
    expect(await restarted.completeUpload(f.session, receipts)).toEqual(expected);
    expect(await f.storage.completeUpload(f.session, receipts)).toEqual(expected);
    expect(await read(f.storage, f.session.key)).toEqual(f.bytes);
  });
  it('keeps replaced part receipts immutable and accepts a repeated identical part', async () => {
    const f = await fixture();
    const previous = Buffer.from('xxxx');
    const old = await f.storage.uploadPart(f.session, 1, previous, hash(previous));
    const receipts = await parts(f);
    expect(await f.storage.uploadPart(f.session, 1, f.bytes.subarray(0, 4), receipts[0]!.sha256)).toEqual(
      receipts[0],
    );
    expect(
      await f.storage.completeUpload(f.session, [old, ...receipts.slice(1)]).catch((e: unknown) => e),
    ).toMatchObject({ code: 'UPLOAD_CHECKSUM_MISMATCH' });
    expect(await f.storage.head(f.session.key).catch((e: unknown) => e)).toMatchObject({
      code: 'OBJECT_NOT_FOUND',
    });
    await f.storage.completeUpload(f.session, receipts);
    expect(await read(f.storage, f.session.key)).toEqual(f.bytes);
  });
  it('refuses oversized, short and incorrectly checksummed parts and cleans temporary files', async () => {
    const f = await fixture();
    for (const bytes of [Buffer.from('too long'), Buffer.from('x')]) {
      await expect(f.storage.uploadPart(f.session, 1, bytes, hash(bytes))).rejects.toMatchObject({
        code: 'UPLOAD_PARTS_INVALID',
      });
    }
    await expect(
      f.storage.uploadPart(f.session, 1, Buffer.from('abcd'), hash(Buffer.from('xxxx'))),
    ).rejects.toMatchObject({ code: 'UPLOAD_CHECKSUM_MISMATCH' });
    expect(await readdir(path.join(f.root, '.uploads', f.session.sessionId))).toEqual(['session.json']);
  });
  it('requires exact receipt coverage and detects tampering before publishing the object', async () => {
    const f = await fixture();
    const receipts = await parts(f);
    for (const invalid of [
      receipts.slice(1),
      [receipts[0]!, receipts[0]!, receipts[2]!],
      [...receipts].reverse(),
    ])
      await expect(f.storage.completeUpload(f.session, invalid)).rejects.toMatchObject({
        code: 'UPLOAD_PARTS_INVALID',
      });
    await writeFile(
      path.join(f.root, '.uploads', f.session.sessionId, `1-${receipts[0]!.sha256}.part`),
      'xxxx',
    );
    await expect(f.storage.completeUpload(f.session, receipts)).rejects.toMatchObject({
      code: 'UPLOAD_CHECKSUM_MISMATCH',
    });
    await expect(f.storage.head(f.session.key)).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND' });
  });
  it('expires exactly at the deadline and can abort expired sessions idempotently', async () => {
    const f = await fixture();
    const receipts = await parts(f);
    f.expire();
    await expect(
      f.storage.uploadPart(f.session, 1, Buffer.from('abcd'), receipts[0]!.sha256),
    ).rejects.toMatchObject({ code: 'UPLOAD_EXPIRED' });
    await expect(f.storage.completeUpload(f.session, receipts)).rejects.toMatchObject({
      code: 'UPLOAD_EXPIRED',
    });
    await f.storage.abortUpload(f.session);
    await f.storage.abortUpload(f.session);
    expect(await readdir(path.join(f.root, '.uploads'))).toEqual([]);
  });
  it('refuses session substitution and traversal before touching another session', async () => {
    const f = await fixture();
    const changed = { ...f.session, sha256: '0'.repeat(64) };
    await expect(f.storage.createUploadSession(changed)).rejects.toMatchObject({ code: 'UPLOAD_CONFLICT' });
    await expect(f.storage.abortUpload(changed)).rejects.toMatchObject({ code: 'UPLOAD_CONFLICT' });
    await expect(
      f.storage.createUploadSession({ ...f.session, sessionId: '../outside' }),
    ).rejects.toMatchObject({ code: 'UPLOAD_INVALID' });
    expect(await readdir(path.join(f.root, '.uploads', f.session.sessionId))).toEqual(['session.json']);
  });
  it('refuses a symlink planted in the upload tree', async () => {
    const f = await fixture();
    const outside = await mkdtemp(path.join(tmpdir(), 'hmedic-upload-outside-'));
    roots.push(outside);
    await rm(path.join(f.root, '.uploads'), { recursive: true, force: true });
    await symlink(outside, path.join(f.root, '.uploads'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(f.storage.createUploadSession(f.session)).rejects.toMatchObject({
      code: 'STORAGE_KEY_INVALID',
    });
    expect(await readdir(outside)).toEqual([]);
  });
  it('handles competing finalizations without sharing a temporary file', async () => {
    const f = await fixture();
    const receipts = await parts(f);
    const results = await Promise.all([
      f.storage.completeUpload(f.session, receipts),
      f.storage.completeUpload(f.session, receipts),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(await read(f.storage, f.session.key)).toEqual(f.bytes);
  });

  it('checks expiry again after a streamed part and abort never deletes a published object', async () => {
    const expired = await fixture();
    const bytes = expired.bytes.subarray(0, 4);
    const body = Readable.from(
      (async function* () {
        yield bytes;
        expired.expire();
      })(),
    );
    await expect(expired.storage.uploadPart(expired.session, 1, body, hash(bytes))).rejects.toMatchObject({
      code: 'UPLOAD_EXPIRED',
    });
    expect(await readdir(path.join(expired.root, '.uploads', expired.session.sessionId))).toEqual([
      'session.json',
    ]);
    const f = await fixture();
    await f.storage.completeUpload(f.session, await parts(f));
    await f.storage.abortUpload(f.session);
    expect(await read(f.storage, f.session.key)).toEqual(f.bytes);
  });

  it('assembles a streamed multi-megabyte upload without collecting the whole file', async () => {
    const f = await fixture();
    const chunk = Buffer.alloc(64 * 1024, 73);
    const digest = createHash('sha256');
    for (let index = 0; index < 192; index++) digest.update(chunk);
    const session = {
      ...f.session,
      sessionId: randomUUID(),
      sizeBytes: chunk.length * 192,
      partSizeBytes: chunk.length * 32,
      sha256: digest.digest('hex'),
    };
    await f.storage.createUploadSession(session);
    const receipts: UploadPartReceipt[] = [];
    for (let number = 1; number <= 6; number++) {
      const partHash = createHash('sha256');
      for (let index = 0; index < 32; index++) partHash.update(chunk);
      const stream = Readable.from(
        (async function* () {
          for (let index = 0; index < 32; index++) yield chunk;
        })(),
      );
      receipts.push(await f.storage.uploadPart(session, number, stream, partHash.digest('hex')));
    }
    expect(await f.storage.completeUpload(session, receipts)).toEqual({
      key: session.key,
      sizeBytes: session.sizeBytes,
      sha256: session.sha256,
    });
    expect(await f.storage.head(session.key)).toMatchObject({
      sizeBytes: session.sizeBytes,
      sha256: session.sha256,
    });
  }, 30_000);
});

it('part geometry preserves total bytes and exact ordered coverage across small file/part domains', async () => {
  const f = await fixture();
  // Exhaustive bounded property: each byte belongs to exactly one non-empty part.
  for (let sizeBytes = 1; sizeBytes <= 64; sizeBytes++)
    for (let partSizeBytes = 1; partSizeBytes <= 16; partSizeBytes++) {
      const session = { ...f.session, sizeBytes, partSizeBytes };
      const sizes = Array.from({ length: Math.ceil(sizeBytes / partSizeBytes) }, (_, index) =>
        uploadPartSize(session, index + 1),
      );
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(sizeBytes);
      expect(sizes.every((size) => size > 0 && size <= partSizeBytes)).toBe(true);
      const receipts = sizes.map((size, index) => ({
        partNumber: index + 1,
        sizeBytes: size,
        sha256: session.sha256,
      }));
      expect(() => assertUploadParts(session, receipts)).not.toThrow();
      expect(() => assertUploadParts(session, receipts.slice(1))).toThrow();
    }
});
