import type { FastifyRequest } from 'fastify';
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
