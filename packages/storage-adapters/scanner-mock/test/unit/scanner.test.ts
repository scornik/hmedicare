import { randomUUID } from 'node:crypto';
import { buildStorageKey, type ScanInput, type ScanVerdict } from '@hmedic/laboratory-documents';
import { expect, it } from 'vitest';
import { MockMalwareScanner } from '../../src/index';
const input = (): ScanInput => ({
  key: buildStorageKey({
    tenantId: randomUUID(),
    documentId: randomUUID(),
    category: 'LAB_REPORT',
    revision: 1,
  }),
  category: 'LAB_REPORT',
  declaredContentType: 'application/pdf',
  sizeBytes: 1,
  sha256: '0'.repeat(64),
});
it.each<ScanVerdict>([
  { result: 'CLEAN' },
  { result: 'REJECTED', reasonCode: 'ACTIVE_PDF_CONTENT' },
  { result: 'ERROR', reasonCode: 'SCAN_UNAVAILABLE' },
])('returns explicit fixture verdicts without mutating fixture state ($result)', async (verdict) => {
  const request = input();
  const scanner = new MockMalwareScanner(new Map([[request.key, verdict]]));
  expect(await scanner.scan(request)).toEqual(verdict);
  const response = await scanner.scan(request);
  Object.assign(response, { result: 'REJECTED' });
  expect(await scanner.scan(request)).toEqual(verdict);
});
it('refuses unknown or malformed keys and discloses its lack of inspection', async () => {
  const scanner = new MockMalwareScanner();
  expect(await scanner.scan(input())).toEqual({ result: 'ERROR', reasonCode: 'SCAN_UNAVAILABLE' });
  expect(await scanner.scan({ ...input(), key: '../outside' })).toMatchObject({ result: 'ERROR' });
  expect(scanner.describe()).toMatchObject({ adapter: 'mock', detectsKnownMalware: false });
});
