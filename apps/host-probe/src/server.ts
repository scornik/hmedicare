import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { Readable } from 'node:stream';
import { createLogger } from '@hmedic/observability';
import {
  type ProbeConfig,
  probeDb,
  probeEgress,
  probeEngine,
  probeLocks,
  probeRuntime,
  probeStorage,
} from './probes';

/**
 * apps/host-probe (HOST-001…013 harness; deviation D-06). A tiny token-protected HTTP app deployed as a
 * separate Hostinger Node app during verification only. It uses its own probe database and never the
 * application database, and is removed after sign-off.
 *
 *   GET  /health/live                  (public) bootId, uptime — HOST-005 lifecycle observation
 *   GET  /probe/db                     HOST-001      GET  /probe/runtime   HOST-002
 *   POST /probe/engine                 HOST-003      POST /probe/locks     HOST-004
 *   POST /probe/storage?mode=write|verify  HOST-007   GET  /probe/egress    HOST-009
 *   POST /probe/logs                   HOST-011      POST /probe/limits/body, GET /probe/limits/slow|download|headers  HOST-013
 */
export interface ProbeServerConfig extends ProbeConfig {
  token: string;
  port: number;
}

const MAX_BODY = 9 * 1_048_576;

function tokenOk(header: string | undefined, token: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const a = createHash('sha256').update(header.slice(7)).digest();
  const b = createHash('sha256').update(token).digest();
  return timingSafeEqual(a, b);
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function createProbeServer(cfg: ProbeServerConfig): http.Server {
  if (cfg.token.length < 32) throw new Error('HOST_PROBE_TOKEN must be at least 32 characters');
  const bootId = randomUUID();
  const startedAt = Date.now();
  const logger = createLogger({
    app: 'host-probe',
    env: cfg.appEnv,
    version: 'probe',
    bootId,
    level: 'info',
  });

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://probe.local');
    try {
      if (url.pathname === '/health/live') {
        return json(res, 200, {
          status: 'ok',
          app: 'host-probe',
          bootId,
          uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        });
      }
      if (!url.pathname.startsWith('/probe/')) return json(res, 404, { code: 'RESOURCE_NOT_FOUND' });
      if (!tokenOk(req.headers.authorization, cfg.token)) return json(res, 401, { code: 'UNAUTHENTICATED' });
      const route = `${req.method} ${url.pathname}`;
      switch (route) {
        case 'GET /probe/db':
          return json(res, 200, await probeDb(cfg));
        case 'GET /probe/runtime':
          return json(res, 200, {
            ...probeRuntime(),
            bootId,
            uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
          });
        case 'POST /probe/engine':
          return json(res, 200, await probeEngine(cfg));
        case 'POST /probe/locks':
          return json(res, 200, await probeLocks(cfg));
        case 'POST /probe/storage':
          return json(
            res,
            200,
            await probeStorage(cfg, url.searchParams.get('mode') === 'verify' ? 'verify' : 'write'),
          );
        case 'GET /probe/egress':
          return json(res, 200, await probeEgress(cfg));
        case 'POST /probe/logs': {
          // HOST-011: the viewer must show these lines with the key-shaped value redacted.
          const fakeKey = `AIza${'X'.repeat(35)}`;
          logger.info(
            // eslint-disable-next-line hmedic/no-secret-logging -- HOST-011 emits a synthetic key to prove redaction on the host.
            { probe: 'HOST-011', apiKey: fakeKey, note: `token=${fakeKey}` },
            'host-probe log redaction check',
          );
          return json(res, 200, {
            emitted: 1,
            lookFor: 'host-probe log redaction check',
            expect: '[REDACTED] instead of the AIza… value',
          });
        }
        case 'POST /probe/limits/body': {
          let size = 0;
          const hash = createHash('sha256');
          for await (const chunk of req) {
            size += (chunk as Buffer).length;
            if (size > MAX_BODY) return json(res, 413, { code: 'PAYLOAD_TOO_LARGE' });
            hash.update(chunk as Buffer);
          }
          return json(res, 200, { bytes: size, sha256: hash.digest('hex') });
        }
        case 'GET /probe/limits/slow': {
          const seconds = Math.min(Number(url.searchParams.get('seconds') ?? '25'), 60);
          await new Promise((r) => setTimeout(r, seconds * 1000));
          return json(res, 200, { waitedSeconds: seconds });
        }
        case 'GET /probe/limits/download': {
          const mb = Math.min(Number(url.searchParams.get('mb') ?? '50'), 100);
          res.writeHead(200, {
            'content-type': 'application/octet-stream',
            'content-length': String(mb * 1_048_576),
          });
          let sent = 0;
          Readable.from(
            (function* () {
              while (sent < mb) {
                sent++;
                yield Buffer.alloc(1_048_576);
              }
            })(),
          ).pipe(res);
          return;
        }
        case 'GET /probe/limits/headers':
          return json(res, 200, {
            remoteAddress: req.socket.remoteAddress,
            forwardedFor: req.headers['x-forwarded-for'] ?? null,
            forwardedProto: req.headers['x-forwarded-proto'] ?? null,
            host: req.headers.host ?? null,
          });
        default:
          return json(res, 404, { code: 'RESOURCE_NOT_FOUND' });
      }
    } catch (error) {
      logger.error({ err: error, route: url.pathname }, 'probe failed');
      return json(res, 500, {
        code: 'INTERNAL_ERROR',
        errorClass: (error as { code?: string }).code ?? 'error',
      });
    }
  });
}
