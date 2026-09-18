import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// SMS-008 guard: the live smoke refuses to run in CI, without the explicit flag, or without a valid phone.
// These cases exit before any network call; the actual send is never executed by tests.
const SCRIPT = path.resolve(__dirname, 'zamanit-live.ts');

function run(env: Record<string, string>) {
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('ZAMANIT_') && k !== 'CI'),
  ) as Record<string, string>;
  return spawnSync(process.execPath, [SCRIPT], {
    env: { ...clean, ...env },
    encoding: 'utf8',
    timeout: 20_000,
  });
}

describe('scripts/smoke/zamanit-live.ts guards', () => {
  it('refuses in CI even with the flag set', () => {
    const r = run({ CI: 'true', ZAMANIT_LIVE_SMOKE: 'true', ZAMANIT_LIVE_SMOKE_TO: '+8801700000091' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('never runs in CI');
  });

  it('refuses without ZAMANIT_LIVE_SMOKE=true', () => {
    const r = run({});
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('ZAMANIT_LIVE_SMOKE=true');
  });

  it('refuses an invalid destination or missing provider settings', () => {
    expect(run({ ZAMANIT_LIVE_SMOKE: 'true', ZAMANIT_LIVE_SMOKE_TO: '01700000091' }).status).toBe(2);
    const missing = run({ ZAMANIT_LIVE_SMOKE: 'true', ZAMANIT_LIVE_SMOKE_TO: '+8801700000091' });
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain('ZAMANIT_BASE_URL is required');
  });
});
