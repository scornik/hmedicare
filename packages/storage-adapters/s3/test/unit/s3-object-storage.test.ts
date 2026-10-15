import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';
import { buildStorageKey, ObjectStorageError } from '@hmedic/laboratory-documents';
import { describe, expect, it, vi } from 'vitest';
import { S3ObjectStorage } from '../../src/index';

const key = () =>
  buildStorageKey({
    tenantId: randomUUID(),
    documentId: randomUUID(),
    category: 'PRESCRIPTION_PDF',
    revision: 1,
  });
function fixture(maxPutBytes?: number) {
  const client = new S3Client({
    region: 'us-east-1',
    endpoint: 'http://127.0.0.1:1',
    credentials: { accessKeyId: 'synthetic-access', secretAccessKey: 'synthetic-secret' },
  });
  const send = vi.spyOn(client, 'send');
  return {
    send,
    client,
    storage: new S3ObjectStorage({ client, bucket: 'synthetic-private-bucket', maxPutBytes }),
  };
}
describe('S3 object storage boundaries', () => {
  it('rejects malformed keys before contacting storage across every operation', async () => {
    const f = fixture();
    for (const bad of ['../private-file', '/absolute/path', 't/not-a-tenant/other/no/1']) {
      for (const action of [
        () => f.storage.put(bad, Buffer.from('x'), 'application/pdf'),
        () => f.storage.get(bad),
        () => f.storage.head(bad),
        () => f.storage.delete(bad),
      ]) {
        await expect(action()).rejects.toMatchObject({ code: 'STORAGE_KEY_INVALID' });
      }
    }
    expect(f.send).not.toHaveBeenCalled();
    f.client.destroy();
  });
  it('stops an oversized stream before uploading and keeps vendor details out of failures', async () => {
    const f = fixture(4);
    await expect(
      f.storage.put(key(), Readable.from([Buffer.from('123'), Buffer.from('456')]), 'application/pdf'),
    ).rejects.toMatchObject({ code: 'STORAGE_IO_FAILED' });
    expect(f.send).not.toHaveBeenCalled();
    f.send.mockRejectedValueOnce(
      Object.assign(new Error('authorization=synthetic-secret-key'), { $metadata: { httpStatusCode: 502 } }),
    );
    const error = await f.storage.put(key(), Buffer.from('123'), 'application/pdf').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ObjectStorageError);
    expect(String(error)).not.toContain('synthetic-secret-key');
    expect(error).toMatchObject({ code: 'STORAGE_IO_FAILED' });
    f.client.destroy();
  });
  it('computes the SHA-256 from streamed bytes and sends an atomic non-overwrite precondition', async () => {
    const f = fixture();
    const bytes = Buffer.from('synthetic private prescription');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const objectKey = key();
    f.send.mockImplementationOnce(async (command) => {
      const input = command.input as {
        Body: Readable;
        Metadata: { sha256: string };
        ContentLength: number;
        IfNoneMatch: string;
      };
      expect(input.IfNoneMatch).toBe('*');
      expect(input.Metadata.sha256).toBe(hash);
      expect(input.ContentLength).toBe(bytes.length);
      const chunks: Buffer[] = [];
      for await (const chunk of input.Body) chunks.push(Buffer.from(chunk as Buffer));
      expect(Buffer.concat(chunks)).toEqual(bytes);
      return {};
    });
    await expect(f.storage.put(objectKey, Readable.from([bytes]), 'application/pdf')).resolves.toEqual({
      key: objectKey,
      sizeBytes: bytes.length,
      sha256: hash,
    });
    f.client.destroy();
  });
  it('maps only known storage outcomes and rejects incomplete integrity metadata', async () => {
    const f = fixture();
    f.send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } });
    await expect(f.storage.head(key())).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND' });
    f.send.mockImplementationOnce(async () => ({ ContentLength: 3, Metadata: {} }));
    await expect(f.storage.head(key())).rejects.toMatchObject({ code: 'STORAGE_IO_FAILED' });
    f.send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 412 } });
    await expect(f.storage.put(key(), Buffer.from('abc'), 'application/pdf')).rejects.toMatchObject({
      code: 'OBJECT_ALREADY_EXISTS',
    });
    f.client.destroy();
  });
});
