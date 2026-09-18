import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyBuildInfo } from '../../src/build-info';

describe('applyBuildInfo (promote-staging version check)', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hm-build-info-'));
  const sha = 'a'.repeat(40);

  it('sets APP_VERSION from dist/build-info.json; an explicit env value wins; junk is ignored', () => {
    writeFileSync(path.join(dir, 'build-info.json'), JSON.stringify({ version: sha }));
    const env: NodeJS.ProcessEnv = {};
    applyBuildInfo(dir, env);
    expect(env.APP_VERSION).toBe(sha);

    const explicit: NodeJS.ProcessEnv = { APP_VERSION: 'v1' };
    applyBuildInfo(dir, explicit);
    expect(explicit.APP_VERSION).toBe('v1');

    writeFileSync(path.join(dir, 'build-info.json'), JSON.stringify({ version: '$(rm -rf /)' }));
    const junk: NodeJS.ProcessEnv = {};
    applyBuildInfo(dir, junk);
    expect(junk.APP_VERSION).toBeUndefined();

    const missing: NodeJS.ProcessEnv = {};
    applyBuildInfo(path.join(dir, 'nope'), missing);
    expect(missing.APP_VERSION).toBeUndefined();
  });
});
