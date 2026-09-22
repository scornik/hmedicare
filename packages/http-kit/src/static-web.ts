import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/**
 * Serves the built web client from the same Node app as the API (Stage 6 DEPLOY-001, ADR-023).
 *
 * The plan allows ten Node apps but one domain each, and the web client had nowhere to live: the domain
 * routed every URL to the API, so `/` answered `RESOURCE_NOT_FOUND` and there was no login page at all.
 * Serving the build from this process makes the client same-origin, which removes CORS from the deployed
 * path entirely — the browser never makes a cross-origin request, so there is no preflight to get wrong
 * and no origin list to keep in step with reality.
 *
 * `@fastify/static` rather than a hand-rolled handler: this is the surface where path traversal lives,
 * and a bug here reads arbitrary files off the server.
 *
 * Splitting the client onto its own subdomain later is configuration, not code: unset `WEB_DIST_DIR`, set
 * `CORS_ALLOWED_ORIGINS` to the new origin, and build the client with `VITE_API_BASE_URL` pointing here.
 */

/** Paths the API owns. A request under one of these is never answered with the SPA shell. */
const API_PREFIXES = ['/api/', '/health/', '/internal/'] as const;
/** Exact paths too, so `/health` without a trailing slash is not swallowed by the fallback. */
const API_EXACT = ['/api', '/health', '/internal'] as const;

export function isApiPath(pathname: string): boolean {
  return API_PREFIXES.some((p) => pathname.startsWith(p)) || API_EXACT.some((p) => pathname === p);
}

/**
 * A SPA fallback must not answer with HTML when the caller asked for something else: a fetch for a
 * missing module should 404, not receive an index page that fails to parse as JavaScript.
 */
export function wantsHtml(accept: string | undefined): boolean {
  return accept !== undefined && accept.includes('text/html');
}

export interface StaticWebOptions {
  /** Directory holding the built client (`index.html` plus `assets/`). */
  root: string;
}

/**
 * True when `root` holds a built client. Checked before registering, because a misconfigured path must
 * not stop the API from starting: the deployed process runs with a working directory that is *not* the
 * application root (Passenger starts it in the home directory), so a relative `WEB_DIST_DIR` silently
 * resolves somewhere else. Losing the web client is bad; losing the API with it would be worse.
 */
export function hasWebBuild(root: string): boolean {
  return existsSync(path.join(path.resolve(root), 'index.html'));
}

export function registerStaticWeb(fastify: FastifyInstance, options: StaticWebOptions): void {
  const root = path.resolve(options.root);
  const indexPath = path.join(root, 'index.html');
  if (!existsSync(indexPath)) {
    throw new Error(`WEB_DIST_DIR (${root}) has no index.html; build the web client or unset the variable`);
  }
  const shell = readFileSync(indexPath);

  void fastify.register(fastifyStatic, {
    root,
    // Misses are handled by the fallback below, so the plugin must not answer with its own index.
    index: false,
    wildcard: false,
  });

  fastify.addHook('onSend', (request, reply, payload, done) => {
    const pathname = request.url.split('?')[0] ?? '/';
    const isRead = request.method === 'GET' || request.method === 'HEAD';

    // Vite fingerprints everything under `assets/`, so those may be cached hard. Everything else — above
    // all the shell — must not be, or a deploy strands browsers on asset names that no longer exist. The
    // shared hook defaults to `no-store`, so only the fingerprinted case needs overriding.
    if (isRead && pathname.startsWith('/assets/') && reply.statusCode < 400) {
      void reply.header('cache-control', 'public, max-age=31536000, immutable');
      done(null, payload);
      return;
    }

    // The SPA fallback. Nest owns the not-found handler — Fastify allows only one and Nest installs its
    // own during `init()` — so a client-routed deep link is recognised by the 404 it produces rather than
    // by claiming a route. The API's own 404s pass through untouched, which is what keeps a mistyped
    // endpoint from returning a login page with status 200 for the caller to parse as JSON.
    if (reply.statusCode === 404 && isRead && !isApiPath(pathname) && wantsHtml(request.headers.accept)) {
      void reply.status(200);
      void reply.header('content-type', 'text/html; charset=utf-8');
      void reply.header('cache-control', 'no-store');
      void reply.removeHeader('content-length');
      done(null, shell);
      return;
    }
    done(null, payload);
  });
}
