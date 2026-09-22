import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ServerConfig, loadConfig } from '@hmedic/config';
import { testEnv } from '@hmedic/config/testing';
import { isApiPath, wantsHtml } from '@hmedic/http-kit';
import { type ApiInstance, buildApi } from '../../src/compose';
import { testDatabaseUrl } from '../../../../tests/support/db';

/**
 * DEPLOY-001 / ADR-023: one Node app serving the built web client at `/` and the API under `/api`.
 *
 * The risk in a SPA fallback is that it answers for things it should not. If it shadows the API, a
 * mistyped endpoint returns an HTML page with status 200 and the client parses a login screen as JSON.
 * If it escapes the build directory, it reads arbitrary files off the server. Both are asserted here.
 */
let api: ApiInstance;
let server: Parameters<typeof request>[0];
let dist: string;

const INDEX = '<!doctype html><title>HMedicare</title><div id="root"></div>';
const ASSET = 'export const build = "synthetic";';

beforeAll(async () => {
  dist = await mkdtemp(path.join(os.tmpdir(), 'hm-web-'));
  await mkdir(path.join(dist, 'assets'), { recursive: true });
  await writeFile(path.join(dist, 'index.html'), INDEX);
  await writeFile(path.join(dist, 'assets', 'app-abc123.js'), ASSET);
  // A file a traversal attempt would aim for, one level above the served root.
  await writeFile(path.join(dist, '..', `hm-secret-${path.basename(dist)}.txt`), 'NOT-SERVABLE');

  api = await buildApi(
    loadConfig<ServerConfig>('api', testEnv({ DATABASE_URL: testDatabaseUrl(), WEB_DIST_DIR: dist })),
  );
  server = api.app.getHttpServer();
});

afterAll(async () => {
  await api?.close();
  if (dist) {
    await rm(path.join(dist, '..', `hm-secret-${path.basename(dist)}.txt`), { force: true });
    await rm(dist, { recursive: true, force: true });
  }
});

describe('single-app profile: the web client', () => {
  it('serves the shell at / and fingerprinted assets with a long cache', async () => {
    const root = await request(server).get('/').set('accept', 'text/html').expect(200);
    expect(root.text).toContain('id="root"');
    expect(root.headers['cache-control']).toBe('no-store');

    const asset = await request(server).get('/assets/app-abc123.js').expect(200);
    expect(asset.text).toBe(ASSET);
    // Vite fingerprints these, so they may be cached hard; the shell never may, or a deploy strands
    // browsers on asset names that no longer exist.
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('returns the shell for a client-routed deep link', async () => {
    const deep = await request(server)
      .get('/patients/01a0c8e8-0000-7000-8000-000000000000')
      .set('accept', 'text/html');
    expect(deep.status).toBe(200);
    expect(deep.text).toContain('id="root"');
  });

  it('never lets the fallback shadow the API', async () => {
    // The dangerous case: a browser navigation to an API path. Answering with the shell would turn a
    // 404 into a 200 full of HTML, and the caller would parse a login page as JSON.
    for (const url of ['/api/v1/no-such-route', '/health/no-such-check', '/internal/no-such-thing']) {
      const res = await request(server).get(url).set('accept', 'text/html');
      expect(res.status, url).toBe(404);
      expect(res.text, url).not.toContain('id="root"');
    }
    // And the API's own routes still answer as themselves.
    await request(server).get('/health/live').expect(200);
    await request(server).get('/api/v1/patients').expect(401);
  });

  it('404s a missing asset rather than handing back HTML', async () => {
    // A fetch for a missing module must fail as a missing module. An HTML shell with status 200 here
    // produces a syntax error in the browser and an unreadable bug report.
    const res = await request(server).get('/assets/gone-999.js');
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('id="root"');
  });

  it('does not serve files outside the build directory', async () => {
    for (const url of [
      `/../hm-secret-${path.basename(dist)}.txt`,
      `/assets/../../hm-secret-${path.basename(dist)}.txt`,
      '/../../../../etc/passwd',
      '/%2e%2e/%2e%2e/etc/passwd',
    ]) {
      const res = await request(server).get(url);
      expect(res.status, url).not.toBe(200);
      expect(res.text ?? '', url).not.toContain('NOT-SERVABLE');
    }
  });

  it('only falls back for GET and HEAD', async () => {
    // A POST to an unknown path is a client error, not a page request.
    const res = await request(server).post('/not-a-route').set('accept', 'text/html').send({});
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('id="root"');
  });
});

describe('single-app profile: path classification', () => {
  it('treats the API surfaces as API, with and without a trailing slash', () => {
    for (const p of ['/api', '/api/', '/api/v1/patients', '/health', '/health/live', '/internal/metrics']) {
      expect(isApiPath(p), p).toBe(true);
    }
    // These belong to the client. `/apitest` must not be mistaken for the API by a prefix check.
    for (const p of ['/', '/patients', '/apitest', '/healthy-living', '/assets/app.js']) {
      expect(isApiPath(p), p).toBe(false);
    }
  });

  it('only offers the shell to something that asked for HTML', () => {
    expect(wantsHtml('text/html,application/xhtml+xml')).toBe(true);
    expect(wantsHtml('application/json')).toBe(false);
    expect(wantsHtml(undefined)).toBe(false);
  });
});

describe('single-app profile: a misconfigured WEB_DIST_DIR', () => {
  it('keeps the API serving instead of failing to start', async () => {
    // The deployed process starts in the home directory, not the application root, so a relative path
    // resolves somewhere that does not exist. Refusing to boot would turn a missing web client into a
    // total outage, so the app logs loudly and carries on serving the API.
    const missing = await buildApi(
      loadConfig<ServerConfig>(
        'api',
        testEnv({ DATABASE_URL: testDatabaseUrl(), WEB_DIST_DIR: path.join(os.tmpdir(), 'hm-not-built') }),
      ),
    );
    try {
      const srv = missing.app.getHttpServer();
      await request(srv).get('/health/live').expect(200);
      await request(srv).get('/api/v1/patients').expect(401);
      // No client to serve, so `/` is a plain 404 rather than a shell.
      const root = await request(srv).get('/').set('accept', 'text/html');
      expect(root.status).toBe(404);
    } finally {
      await missing.close();
    }
  });
});
