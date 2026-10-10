import { Controller, Get, Inject, Param, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError } from '@hmedic/kernel';
import type { CommunicationShortLinks } from '@hmedic/communication';
import type { ResolvedPatientContext } from '@hmedic/identity-access';
import { CurrentPatientContext, PatientContextRoute } from '@hmedic/identity-access/nest';
import { RateLimit } from '@hmedic/http-kit';

export const COMMUNICATION_SHORT_LINKS = Symbol('COMMUNICATION_SHORT_LINKS');
@Controller('communication-links')
export class CommunicationLinksController {
  constructor(@Inject(COMMUNICATION_SHORT_LINKS) private readonly links: CommunicationShortLinks | null) {}
  @Get(':token')
  @PatientContextRoute({ mode: 'only', scope: 'VIEW_RECORDS' })
  @RateLimit({ rule: { scope: 'communication-link-read', limit: 30, windowSeconds: 60 }, by: 'ip' })
  resolve(
    @Param('token') token: string,
    @CurrentPatientContext() ctx: ResolvedPatientContext,
    @Req() req: FastifyRequest,
  ) {
    if (!this.links) throw new AppError('FEATURE_DISABLED');
    return this.links.resolve(ctx.tenantId, ctx.patientId, token, {
      userId: ctx.userId,
      actingAs: ctx.actingAs,
      requestId: req.id,
    });
  }
}
