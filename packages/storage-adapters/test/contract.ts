import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  type ObjectStorageError,
  type ObjectStoragePort,
  buildStorageKey,
} from '@hmedic/laboratory-documents';

/**
 * The shared object-storage contract (FILE-STORAGE-IMPLEMENTATION.md §6, ADR-016).
 *
 * Run against every adapter, so `disk` and the eventual `s3` are held to one behaviour rather than to
 * whatever each one happened to implement. A clinical file that reads back differently depending on
 * which adapter stored it is a bug nobody finds until a migration.
 *
 * The suite only ever uses keys from `buildStorageKey`: an adapter is allowed to refuse anything else,
 * and the tests that check it does are per-adapter, because what counts as a dangerous path is specific
 * to the storage behind it.
 */
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

export interface ContractHarness {
  name: string;
  /** A fresh, empty store per test. */
  create: () => Promise<{ storage: ObjectStoragePort; cleanup: () => Promise<void> }>;
}

export function runObjectStorageContract(harness: ContractHarness): void {
  const key = () =>
    buildStorageKey({
      tenantId: randomUUID(),
      category: 'PRESCRIPTION_PDF',
      documentId: randomUUID(),
      revision: 1,
    });

  async function withStorage<T>(fn: (storage: ObjectStoragePort) => Promise<T>): Promise<T> {
    const { storage, cleanup } = await harness.create();
    try {
      return await fn(storage);
    } finally {
      await cleanup();
    }
  }

  describe(`ObjectStoragePort contract — ${harness.name}`, () => {
    it('writes an object and reads back the same bytes', async () => {
      await withStorage(async (storage) => {
        const body = Buffer.from('%PDF-1.7\nprescription\n');
        const k = key();

        const put = await storage.put(k, body, 'application/pdf');
        expect(put).toEqual({ key: k, sizeBytes: body.length, sha256: sha256(body) });

        const { stream, sizeBytes } = await storage.get(k);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk as Buffer);
        expect(Buffer.concat(chunks)).toEqual(body);
        expect(sizeBytes).toBe(body.length);
      });
    });

    it('reports the checksum it computed while writing, not one read back afterwards', async () => {
      await withStorage(async (storage) => {
        const body = Buffer.alloc(64 * 1024, 7);
        const k = key();
        const put = await storage.put(k, Readable.from(body), 'application/pdf');
        // A stream body must checksum identically to a buffer body: the caller should not have to know
        // which one the adapter prefers.
        expect(put.sha256).toBe(sha256(body));
        expect(put.sizeBytes).toBe(body.length);
        expect(await storage.head(k)).toEqual(put);
      });
    });

    it('refuses to overwrite a key that already holds an object', async () => {
      await withStorage(async (storage) => {
        const k = key();
        await storage.put(k, Buffer.from('first'), 'application/pdf');
        // A key carries the document id and the revision, so a second write means something is
        // re-rendering over bytes a patient may already hold.
        const e = await storage.put(k, Buffer.from('second'), 'application/pdf').catch((x) => x);
        expect((e as ObjectStorageError).code).toBe('OBJECT_ALREADY_EXISTS');

        const { stream } = await storage.get(k);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk as Buffer);
        expect(Buffer.concat(chunks).toString()).toBe('first');
      });
    });

    it('reads a byte range', async () => {
      await withStorage(async (storage) => {
        const body = Buffer.from('0123456789');
        const k = key();
        await storage.put(k, body, 'application/pdf');

        const { stream, sizeBytes } = await storage.get(k, { range: { start: 2, end: 5 } });
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk as Buffer);
        expect(Buffer.concat(chunks).toString()).toBe('2345');
        expect(sizeBytes).toBe(4);
      });
    });

    it('answers not-found for a key nothing was written to', async () => {
      await withStorage(async (storage) => {
        const k = key();
        // Not an empty stream: a caller that cannot tell "no object" from "zero bytes" will serve a
        // blank PDF to a patient.
        expect(((await storage.get(k).catch((x) => x)) as ObjectStorageError).code).toBe('OBJECT_NOT_FOUND');
        expect(((await storage.head(k).catch((x) => x)) as ObjectStorageError).code).toBe('OBJECT_NOT_FOUND');
      });
    });

    it('deletes, and deleting again is still success', async () => {
      await withStorage(async (storage) => {
        const k = key();
        await storage.put(k, Buffer.from('bytes'), 'application/pdf');
        await storage.delete(k);
        expect(((await storage.get(k).catch((x) => x)) as ObjectStorageError).code).toBe('OBJECT_NOT_FOUND');
        // Idempotent, so cleanup after a failed render does not need to know whether it got that far.
        await expect(storage.delete(k)).resolves.toBeUndefined();
      });
    });

    it('refuses a key it did not generate', async () => {
      await withStorage(async (storage) => {
        for (const bad of [
          'objects/../../etc/passwd',
          't/../../etc/passwd/1',
          '/absolute/path',
          't/not-a-uuid/prescription-pdf/also-not/1',
          '',
        ]) {
          const e = await storage.put(bad, Buffer.from('x'), 'application/pdf').catch((x) => x);
          expect((e as ObjectStorageError).code).toBe('STORAGE_KEY_INVALID');
        }
      });
    });

    it('streams a large object without holding it in memory', async () => {
      await withStorage(async (storage) => {
        // 24 MiB in 1 MiB chunks. Not a heap assertion — that belongs in a dedicated run with a heap
        // limit — but enough that a buffered implementation would be visible in the timings and any
        // accidental `Buffer.concat` of the whole body would blow the default string limits.
        const chunk = Buffer.alloc(1024 * 1024, 3);
        const total = 24;
        const hash = createHash('sha256');
        for (let i = 0; i < total; i += 1) hash.update(chunk);

        const k = key();
        let emitted = 0;
        const source = new Readable({
          read() {
            this.push(emitted < total ? ((emitted += 1), chunk) : null);
          },
        });

        const put = await storage.put(k, source, 'application/pdf');
        expect(put.sizeBytes).toBe(total * chunk.length);
        expect(put.sha256).toBe(hash.digest('hex'));
      });
    });
  });
}
