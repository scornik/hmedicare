import { createHash, randomUUID } from 'node:crypto';
import type * as ChildProcess from 'node:child_process';
import { access } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { buildStorageKey, type ScanInput } from '@hmedic/laboratory-documents';
import { BaselineContentPolicyScanner } from '../../src/index';

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof ChildProcess>()),
  execFile: Object.assign(() => undefined, { [Symbol.for('nodejs.util.promisify.custom')]: mocks.run }),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  mocks.run.mockReset();
});

function fixture() {
  const bytes = Buffer.from('%PDF-1.7\nsynthetic input\n%%EOF');
  const input: ScanInput = {
    key: buildStorageKey({
      tenantId: randomUUID(),
      documentId: randomUUID(),
      category: 'LAB_REPORT',
      revision: 1,
    }),
    category: 'LAB_REPORT',
    declaredContentType: 'application/pdf',
    sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  const storage = {
    adapter: 'disk' as const,
    get: vi.fn(async () => ({ stream: Readable.from([bytes]), sizeBytes: bytes.length })),
    put: vi.fn(),
    head: vi.fn(),
    delete: vi.fn(),
  };
  const policy = { maxBytes: 1024, maxPdfPages: 5, maxImagePixels: 1000, allowedTypes: ['application/pdf'] };
  const scanner = new BaselineContentPolicyScanner({
    storage,
    limits: { LAB_REPORT: policy, IMAGE: policy, REFERRAL: policy, OTHER: policy },
  });
  return { input, storage, scanner, bytes };
}
it('bounds the child process, excludes application secrets and cleans private files after parser failure', async () => {
  vi.stubEnv('DATABASE_URL', 'synthetic-private-diagnostic');
  vi.stubEnv('AI_CREDENTIAL_KEK', 'synthetic-private-diagnostic');
  vi.stubEnv('NODE_OPTIONS', '--trace-warnings');
  mocks.run.mockRejectedValueOnce(new Error('synthetic-private-diagnostic'));
  const f = fixture();
  expect(await f.scanner.scan(f.input)).toEqual({ result: 'ERROR', reasonCode: 'SCAN_UNAVAILABLE' });
  const [executable, args, options] = mocks.run.mock.calls[0]!;
  expect(executable).toBe(process.execPath);
  expect(args[0]).toBe('--max-old-space-size=192');
  expect(options).toMatchObject({ timeout: 20_000, maxBuffer: 8192, windowsHide: true });
  expect(options.env).not.toHaveProperty('DATABASE_URL');
  expect(options.env).not.toHaveProperty('AI_CREDENTIAL_KEK');
  expect(options.env).not.toHaveProperty('NODE_OPTIONS');
  await expect(access(options.cwd)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(f.storage.put).not.toHaveBeenCalled();
});
it.each([
  'not JSON',
  '{"result":"CLEAN","sanitized":"yes"}',
  '{"result":"REJECTED","reasonCode":"unknown"}',
  '{"result":"ERROR","reasonCode":"SCAN_UNAVAILABLE"}',
])('fails closed for invalid or unavailable parser replies (%s)', async (stdout) => {
  mocks.run.mockResolvedValueOnce({ stdout, stderr: '' });
  const f = fixture();
  expect(await f.scanner.scan(f.input)).toEqual({ result: 'ERROR', reasonCode: 'SCAN_UNAVAILABLE' });
  const options = mocks.run.mock.calls[0]![2];
  await expect(access(options.cwd)).rejects.toMatchObject({ code: 'ENOENT' });
});
it('rejects a stream that exceeds its promised size before invoking the parser', async () => {
  const f = fixture();
  f.storage.get.mockResolvedValueOnce({
    stream: Readable.from([f.bytes, Buffer.from('extra')]),
    sizeBytes: f.input.sizeBytes,
  });
  expect(await f.scanner.scan(f.input)).toEqual({ result: 'REJECTED', reasonCode: 'SIZE_LIMIT' });
  expect(mocks.run).not.toHaveBeenCalled();
});
