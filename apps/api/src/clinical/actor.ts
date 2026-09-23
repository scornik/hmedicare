import type { FastifyRequest } from 'fastify';
import type { ActorContext, TenantContext } from '@hmedic/kernel';
import type { ClinicalActor } from '@hmedic/clinical';
import type { PrismaClient } from '@hmedic/database';
import type { HttpRuntime } from '@hmedic/http-kit';

/**
 * Every clinical command needs the acting user's doctor profile, because assignment is defined in terms
 * of the doctor, not the user (AUTHORIZATION-MATRIX §3).
 *
 * Staff without a profile get `null` rather than a refusal here: a nurse has no doctor profile and is
 * still allowed to draft a note in their chamber. Where a profile is genuinely required — signing,
 * recording a diagnosis — the service says so, so the rule lives next to the reason for it.
 */
export async function clinicalActor(
  runtime: HttpRuntime,
  actor: ActorContext,
  tenant: TenantContext,
  req: FastifyRequest,
): Promise<ClinicalActor> {
  const prisma = runtime.prisma as PrismaClient;
  const profile = await prisma.doctorProfile.findFirst({
    where: { tenantId: tenant.tenantId, userId: actor.userId, status: 'ACTIVE' },
    select: { id: true },
  });
  return {
    userId: actor.userId,
    tenant,
    doctorProfileId: profile?.id ?? null,
    requestId: req.id,
    correlationId: req.id,
  };
}

export function idempotencyKey(req: FastifyRequest): string | null {
  const header = req.headers['idempotency-key'];
  return typeof header === 'string' && header.length > 0 ? header : null;
}
