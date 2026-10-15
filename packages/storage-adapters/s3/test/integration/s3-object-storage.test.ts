import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildStorageKey, type ObjectStorageError } from '@hmedic/laboratory-documents';
import { runObjectStorageContract } from '../../../test/contract';
import { S3ObjectStorage } from '../../src/index';

// Reuse the existing reviewed local image pin; never address a production bucket.
const compose = readFileSync(
  path.resolve(__dirname, '../../../../../infrastructure/docker/compose.yaml'),
  'utf8',
);
const image = compose.match(/image:\s*(quay\.io\/minio\/minio@sha256:[a-f0-9]{64})/)?.[1];
if (!image) throw new Error('The local MinIO image must be pinned');
let container: StartedTestContainer;
let client: S3Client;
let endpoint: string;
beforeAll(async () => {
  container = await new GenericContainer(image)
    .withEnvironment({
      MINIO_ROOT_USER: 'synthetic-local-access',
      MINIO_ROOT_PASSWORD: 'synthetic-local-secret-password',
    })
    .withCommand(['server', '/data'])
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/minio/health/ready', 9000).forStatusCode(200))
    .withStartupTimeout(120_000)
    .start();
  endpoint = `http://${container.getHost()}:${container.getMappedPort(9000)}`;
  client = new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: 'synthetic-local-access',
      secretAccessKey: 'synthetic-local-secret-password',
    },
  });
}, 150_000);
afterAll(async () => {
  client?.destroy();
  await container?.stop();
});
async function create() {
  const bucket = `hmedic-${randomUUID()}`;
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  return {
    bucket,
    storage: new S3ObjectStorage({ client, bucket }),
    cleanup: async () => {
      const objects = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
      if (objects.Contents?.length)
        await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: objects.Contents.map((o) => ({ Key: o.Key! })) },
          }),
        );
      await client.send(new DeleteBucketCommand({ Bucket: bucket }));
    },
  };
}
runObjectStorageContract({ name: 's3 / local MinIO', create });
describe('private S3 storage integrity', () => {
  it('allows only one writer to claim a revision and keeps unsigned reads private', async () => {
    const f = await create();
    try {
      const key = buildStorageKey({
        tenantId: randomUUID(),
        documentId: randomUUID(),
        category: 'PRESCRIPTION_PDF',
        revision: 1,
      });
      const writes = await Promise.allSettled([
        f.storage.put(key, Buffer.from('first'), 'application/pdf'),
        f.storage.put(key, Buffer.from('second'), 'application/pdf'),
      ]);
      expect(writes.filter((w) => w.status === 'fulfilled')).toHaveLength(1);
      const rejected = writes.find((w) => w.status === 'rejected') as PromiseRejectedResult;
      expect((rejected.reason as ObjectStorageError).code).toBe('OBJECT_ALREADY_EXISTS');
      expect((await fetch(`${endpoint}/${f.bucket}/${key}`)).status).toBe(403);
    } finally {
      await f.cleanup();
    }
  });
  it('refuses an object without the adapter integrity metadata', async () => {
    const f = await create();
    try {
      const key = buildStorageKey({
        tenantId: randomUUID(),
        documentId: randomUUID(),
        category: 'PRESCRIPTION_PDF',
        revision: 1,
      });
      await client.send(new PutObjectCommand({ Bucket: f.bucket, Key: key, Body: 'foreign object' }));
      await expect(f.storage.head(key)).rejects.toMatchObject({ code: 'STORAGE_IO_FAILED' });
    } finally {
      await f.cleanup();
    }
  });
});
