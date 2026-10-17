import {
  assertStorageKey,
  type MalwareScanPort,
  type ScanInput,
  type ScanVerdict,
} from '@hmedic/laboratory-documents';

/** Local/CI only. Unknown fixtures fail closed; this adapter does not inspect bytes. */
export class MockMalwareScanner implements MalwareScanPort {
  private readonly fixtures: ReadonlyMap<string, ScanVerdict>;
  constructor(fixtures: ReadonlyMap<string, ScanVerdict> = new Map()) {
    this.fixtures = new Map(
      [...fixtures].map(([key, verdict]) => {
        assertStorageKey(key);
        return [key, structuredClone(verdict)];
      }),
    );
  }
  async scan(input: ScanInput): Promise<ScanVerdict> {
    try {
      assertStorageKey(input.key);
      return structuredClone(
        this.fixtures.get(input.key) ?? { result: 'ERROR', reasonCode: 'SCAN_UNAVAILABLE' },
      );
    } catch {
      return { result: 'ERROR', reasonCode: 'SCAN_UNAVAILABLE' };
    }
  }
  describe() {
    return {
      adapter: 'mock',
      detectsKnownMalware: false,
      limits: ['Fixture verdicts only; no content inspection. Never use in production.'],
    };
  }
}
