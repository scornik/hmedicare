import { Controller, Get, Inject, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import type { FastifyRequest } from 'fastify';
import { AppError, type ActorContext, type TenantContext } from '@hmedic/kernel';
import { TimelineQuery } from '@hmedic/contracts';
import {
  CurrentActor,
  CurrentPatientContext,
  OptionalTenant,
  PatientContextRoute,
  RequirePermission,
} from '@hmedic/identity-access/nest';
import type { ResolvedPatientContext } from '@hmedic/identity-access';
import { PATIENT_SERVICES, type PatientServices } from '@hmedic/patient/nest';
import { SCHEDULING_SERVICES, type SchedulingServices } from '@hmedic/scheduling/nest';
import { AssignmentPolicy, ClinicalHistoryMetadata } from '@hmedic/clinical';
import { TIMELINE_READER } from '@hmedic/timeline/nest';
import type { TimelineReader, TimelineReadAccess } from '@hmedic/timeline';
import { HTTP_RUNTIME, type HttpRuntime } from '@hmedic/http-kit';
import { withTransaction } from '@hmedic/database';
import { clinicalActor } from '../clinical/actor';
import { contextActor, staffActor } from '../patient/patient.controllers';
class QueryDto extends createZodDto(TimelineQuery) {}
@Controller('patients')
export class TimelineController {
  constructor(
    @Inject(TIMELINE_READER) private readonly reader: TimelineReader,
    @Inject(HTTP_RUNTIME) private readonly runtime: HttpRuntime,
    @Inject(PATIENT_SERVICES) private readonly patients: PatientServices,
    @Inject(SCHEDULING_SERVICES) private readonly scheduling: SchedulingServices,
  ) {}
  @Get(':id/timeline')
  @RequirePermission('timeline.read')
  @PatientContextRoute({ mode: 'or-staff', scope: 'VIEW_RECORDS' })
  async get(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) patientId: string,
    @Query() query: QueryDto,
    @Req() req: FastifyRequest,
    @CurrentPatientContext() ctx?: ResolvedPatientContext,
    @OptionalTenant() tenant?: TenantContext,
  ) {
    let access: TimelineReadAccess;
    if (ctx) {
      await this.patients.patients.getForContext(contextActor(ctx, req), patientId);
      access = {
        tenantId: ctx.tenantId,
        patientId,
        view: 'patient',
        binding: JSON.stringify([
          ctx.userId,
          ctx.actingAs,
          ctx.guardianshipId,
          [...ctx.authorityScope].sort(),
        ]),
        canRead: async () => true,
      };
    } else {
      if (!tenant) throw new AppError('TENANT_CONTEXT_REQUIRED');
      await this.patients.patients.get(staffActor(actor, tenant, req), patientId);
      const who = await clinicalActor(this.runtime, actor, tenant, req);
      if (
        tenant.role === 'doctor' &&
        !(
          await new AssignmentPolicy(this.runtime.prisma, () => this.runtime.clock.now()).isAssignedToPatient(
            { tenantId: tenant.tenantId, doctorProfileId: who.doctorProfileId },
            patientId,
          )
        ).assigned
      )
        throw new AppError('FORBIDDEN');
      if (!['doctor', 'tenant_owner', 'clinic_admin', 'nurse', 'receptionist'].includes(tenant.role))
        throw new AppError('FORBIDDEN');
      const metadata = new ClinicalHistoryMetadata(this.runtime.prisma);
      access = {
        tenantId: tenant.tenantId,
        patientId,
        view: tenant.role === 'receptionist' ? 'operational' : 'clinical',
        binding: JSON.stringify([
          actor.userId,
          tenant.membershipId,
          tenant.role,
          who.doctorProfileId,
          [...tenant.clinicIds].sort(),
          [...tenant.chamberIds].sort(),
        ]),
        canRead: async (ref) => {
          if (tenant.role === 'doctor' || tenant.role === 'tenant_owner') return true;
          const parent = ref.encounterId
            ? (await metadata.read(tenant!.tenantId, 'encounter', ref.encounterId))[0]
            : null;
          const chamberId = ref.chamberId ?? (parent && 'chamberId' in parent ? parent.chamberId : undefined);
          if (typeof chamberId !== 'string')
            return tenant!.clinicIds.length === 0 && tenant!.chamberIds.length === 0;
          try {
            await this.scheduling.chambers.get(staffActor(actor, tenant!, req), chamberId);
            return true;
          } catch (error) {
            if (error instanceof AppError && ['FORBIDDEN', 'RESOURCE_NOT_FOUND'].includes(error.code))
              return false;
            throw error;
          }
        },
      };
    }
    const result = await this.reader.list(access, query);
    await withTransaction(this.runtime.prisma, (tx) =>
      this.runtime.audit.append(tx, {
        tenantId: access.tenantId,
        actorUserId: actor.userId,
        actorType: ctx ? 'PATIENT_CONTEXT' : 'USER',
        actingAs: ctx?.actingAs ?? null,
        onBehalfOfPatientId: ctx?.patientId ?? null,
        action: 'TIMELINE_READ',
        resourceType: 'patient',
        resourceId: patientId,
        outcome: 'SUCCESS',
        requestId: req.id,
        correlationId: req.id,
        metadata: {
          view: access.view,
          projectionVersion: result.projectionVersion,
          count: result.items.length,
        },
      }),
    );
    return result;
  }
}
