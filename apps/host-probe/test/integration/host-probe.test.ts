import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProbeServer } from '../../src/server';
import { testDatabaseUrl } from '../../../../tests/support/db';

// HOST harness self-test: the probes pass on the pinned local engines, and every probe route is token-gated.
const TOKEN = 'probe-token-for-tests-only-0123456789abcdef';
const storageDir = mkdtempSync(path.join(os.tmpdir(), 'hmedic-probe-'));
let base = '';
let server: ReturnType<typeof createProbeServer>;

beforeAll(async () => {
  server = createProbeServer({
    token: TOKEN,
    port: 0,
    databaseUrl: testDatabaseUrl(),
    appEnv: 'test',
    storageDir,
    egressTargets: [],
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  rmSync(storageDir, { recursive: true, force: true });
});

const call = (p: string, method = 'GET', body?: string | Uint8Array<ArrayBuffer>) =>
  fetch(`${base}${p}`, { method, headers: { authorization: `Bearer ${TOKEN}` }, ...(body ? { body } : {}) });

describe('host-probe', () => {
  it('requires the token for every probe route; health is public', async () => {
    expect((await fetch(`${base}/health/live`)).status).toBe(200);
    for (const p of ['/probe/db', '/probe/runtime', '/probe/egress']) {
      expect((await fetch(`${base}${p}`)).status).toBe(401);
      expect((await fetch(`${base}${p}`, { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
    }
  });

  it('HOST-001/002: engine version, 30 connections, runtime and native modules', async () => {
    const db = (await (await call('/probe/db')).json()) as Record<string, unknown>;
    expect(db).toMatchObject({ isMariaDb: true, atLeast106: true, collationAvailable: true, pass: true });
    expect(db.concurrentConnections).toBeGreaterThanOrEqual(30);
    const rt = (await (await call('/probe/runtime')).json()) as {
      node24: boolean;
      modules: { argon2: string };
    };
    expect(rt.node24).toBe(true);
    expect(rt.modules.argon2).toBe('loaded');
  });

  it('HOST-003/004: engine contract checks and GET_LOCK exclusivity pass on scratch tables', async () => {
    const engine = (await (await call('/probe/engine', 'POST')).json()) as {
      pass: boolean;
      checks: Record<string, unknown>;
    };
    expect(engine.checks).toMatchObject({
      skipLocked: true,
      conditionalClaim: true,
      checkConstraint: true,
      generatedUnique: true,
      jsonAndBangla: true,
      lockWaitTimeout: true,
    });
    expect(engine.pass).toBe(true);
    const locks = (await (await call('/probe/locks', 'POST')).json()) as { getLockExclusive: boolean };
    expect(locks.getLockExclusive).toBe(true);
  });

  it('HOST-007/013: storage round trip, body limit and forwarded headers', async () => {
    const w = (await (await call('/probe/storage?mode=write', 'POST')).json()) as { sha256: string };
    const v = (await (await call('/probe/storage?mode=verify', 'POST')).json()) as {
      sha256: string;
      matches: boolean;
    };
    expect(v).toMatchObject({ matches: true, sha256: w.sha256 });
    const body = (await (await call('/probe/limits/body', 'POST', new Uint8Array(8 * 1_048_576))).json()) as {
      bytes: number;
    };
    expect(body.bytes).toBe(8 * 1_048_576);
    expect((await call('/probe/limits/body', 'POST', new Uint8Array(10 * 1_048_576))).status).toBe(413);
    const h = (await (await call('/probe/limits/headers')).json()) as Record<string, unknown>;
    expect(h).toHaveProperty('forwardedProto');
  });
});
