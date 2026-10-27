import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { registerHttpHooks } from '../../src/fastify-hooks';
import { registerStaticWeb, resolveWebBuild } from '../../src/static-web';
import type { HttpRuntime } from '../../src/runtime';

it('serves executable same-origin HTML while preserving deny-all API and missing-asset policies', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hmedic-web-csp-'));
  const app = Fastify();
  try {
    await mkdir(path.join(root, 'assets'));
    await writeFile(path.join(root, 'index.html'), '<html><script src="/assets/app.js"></script></html>');
    await writeFile(path.join(root, 'assets/app.js'), 'document.body.dataset.booted="yes"');
    registerHttpHooks(app, {
      config: { APP_ENV: 'production' },
      metrics: { httpRequests: { inc: vi.fn() }, httpDuration: { observe: vi.fn() } },
      logger: { info: vi.fn() },
    } as unknown as HttpRuntime);
    registerStaticWeb(app, { root });
    app.get('/api/v1/probe', () => ({ ok: true }));
    for (const url of ['/', '/login', '/dashboard', '/index.html']) {
      const response = await app.inject({ url, headers: { accept: 'text/html' } });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('/assets/app.js');
      const csp = response.headers['content-security-policy'];
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("style-src 'self' 'unsafe-inline'");
      expect(csp).toContain("connect-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toContain("script-src 'unsafe-inline'");
    }
    const asset = await app.inject('/assets/app.js');
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toContain('immutable');
    for (const url of ['/api/v1/probe', '/api/v1/missing', '/assets/missing.js']) {
      const response = await app.inject({ url, headers: { accept: 'application/json' } });
      expect(response.headers['content-security-policy']).toBe(
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      );
      expect(response.body).not.toContain('<html>');
    }
  } finally {
    await app.close();
    // Only removes this test's own mkdtemp directory.
    await rm(root, { recursive: true, force: true });
  }
});

it('finds the web build beside the deployed API when the configured release path is stale', async () => {
  const release = await mkdtemp(path.join(tmpdir(), 'hmedic-release-'));
  try {
    const apiDist = path.join(release, 'apps/api/dist');
    const webDist = path.join(release, 'apps/web/dist');
    await mkdir(apiDist, { recursive: true });
    await mkdir(webDist, { recursive: true });
    await writeFile(path.join(webDist, 'index.html'), '<html></html>');
    const stale = path.join(release, 'old-web/dist');
    expect(resolveWebBuild(stale, apiDist)).toBe(webDist);
    expect(resolveWebBuild(webDist, apiDist)).toBe(webDist);
    expect(resolveWebBuild(undefined, apiDist)).toBeUndefined();
  } finally {
    await rm(release, { recursive: true, force: true });
  }
});
