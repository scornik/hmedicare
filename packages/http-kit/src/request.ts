import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ActorContext, PlatformContext, TenantContext } from '@hmedic/kernel';

/** Per-request state set by the HTTP layer and later by the auth guards (identity-access). */
export interface HmRequestState {
  /** Set by the identity AuthGuard after bearer authentication. */
  actor?: ActorContext;
  tenant?: TenantContext;
  platform?: PlatformContext;
  /** Set by the identity AuthGuard from `X-Patient-Context` (shape owned by identity-access ports). */
  patientContext?: {
    userId: string;
    tenantId: string;
    patientId: string;
    actingAs: 'SELF' | 'GUARDIAN';
    guardianshipId: string | null;
    authorityScope: ReadonlySet<string>;
  };
  /** Resolved tenant (after membership validation), null for platform/public routes. */
  tenantId?: string | null;
  actorUserId?: string | null;
  /** Set by the idempotency interceptor when a stored response is replayed. */
  replayed?: boolean;
  idempotency?: IdempotencyHandle;
  /** Applied in `onSend`: Nest re-applies the route default status after the handler returns. */
  statusOverride?: number;
}

export interface IdempotencyHandle {
  recordId: string;
  completedInTx: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    hm?: HmRequestState;
  }
}

export function hmState(request: FastifyRequest): HmRequestState {
  request.hm ??= {};
  return request.hm;
}

/** Route template (never the raw path) for logs and metrics. */
export function routeTemplate(request: FastifyRequest): string {
  return request.routeOptions?.url ?? 'unmatched';
}

/** Sets a dynamic success status (e.g. 202, 503) for the current request. Errors ignore it. */
export function setResponseStatus(request: FastifyRequest, status: number): void {
  hmState(request).statusOverride = status;
}

/**
 * ETag polling for the live queue (ADR-013, audit C-09): a staff board is polled every 5 s and a patient
 * screen every 15 s, so an unchanged board has to cost a 304 with no body rather than a whole snapshot.
 * The tag is always published; when the caller already holds this version the status is set to 304 and the
 * `onSend` hook drops the payload, which is what makes the poll cheap.
 */
export function notModified(request: FastifyRequest, reply: FastifyReply, etag: string): boolean {
  const tag = etag.startsWith('"') ? etag : `"${etag}"`;
  void reply.header('etag', tag);
  const header = request.headers['if-none-match'];
  if (typeof header !== 'string') return false;
  // A client may send a list, and an intermediary may have weakened the tag it passed on.
  const matched = header
    .split(',')
    .map((v) => v.trim().replace(/^W\//, ''))
    .some((v) => v === tag || v === '*');
  if (matched) setResponseStatus(request, 304);
  return matched;
}
