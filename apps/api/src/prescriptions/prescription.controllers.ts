import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { createZodDto } from 'nestjs-zod';
import type { ActorContext, TenantContext } from '@hmedic/kernel';
import {
  ApprovePrescriptionRequest,
  EditPrescriptionRequest,
  PrescriptionRowVersionOnly,
  VoidPrescriptionRequest,
} from '@hmedic/contracts';
import { HTTP_RUNTIME, Idempotent, type HttpRuntime } from '@hmedic/http-kit';
import { CurrentActor, CurrentTenant, RequirePermission } from '@hmedic/identity-access/nest';
import { PRESCRIPTION_SERVICES, type PrescriptionServices } from '@hmedic/prescriptions/nest';
import type { PrescriptionView } from '@hmedic/prescriptions';
import { clinicalActor } from '../clinical/actor';

class EditPrescriptionDto extends createZodDto(EditPrescriptionRequest) {}
class ApprovePrescriptionDto extends createZodDto(ApprovePrescriptionRequest) {}
class VoidPrescriptionDto extends createZodDto(VoidPrescriptionRequest) {}
class RowVersionOnlyDto extends createZodDto(PrescriptionRowVersionOnly) {}

/**
 * Prescriptions (API §3.7, PRESCRIPTION-IMPLEMENTATION.md §1, Stage 7 CP10).
 *
 * Permissions split the lifecycle the way responsibility does: `prescription.write` edits,
 * `prescription.review` marks items checked, `prescription.approve` puts a doctor's name on what a
 * patient will be given, `prescription.void` withdraws it. The service re-checks assignment inside the
 * transaction, because a coverage grant that lapsed between opening the editor and pressing approve
 * must not approve.
 */
@Controller()
export class PrescriptionController {
  constructor(
    @Inject(PRESCRIPTION_SERVICES) private readonly svc: PrescriptionServices,
    @Inject(HTTP_RUNTIME) private readonly runtime: HttpRuntime,
  ) {}

  /** The acting doctor profile, resolved per request (see `clinical/actor.ts`). */
  private actor(actor: ActorContext, tenant: TenantContext, req: FastifyRequest) {
    return clinicalActor(this.runtime, actor, tenant, req);
  }

  /** The encounter's open draft, created on first use. */
  @Post('encounters/:id/prescriptions')
  @HttpCode(201)
  @RequirePermission('prescription.write')
  @Idempotent()
  async createDraft(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id') encounterId: string,
    @Req() req: FastifyRequest,
  ): Promise<PrescriptionView> {
    return this.svc.prescriptions.openDraft(await this.actor(actor, tenant, req), encounterId);
  }

  @Get('encounters/:id/prescriptions')
  @RequirePermission('prescription.read')
  async listForEncounter(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id') encounterId: string,
    @Req() req: FastifyRequest,
  ): Promise<{ items: PrescriptionView[] }> {
    const items = await this.svc.prescriptions.listForEncounter(
      await this.actor(actor, tenant, req),
      encounterId,
    );
    return { items };
  }

  @Get('prescriptions/:id')
  @RequirePermission('prescription.read')
  async get(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<PrescriptionView> {
    return this.svc.prescriptions.get(await this.actor(actor, tenant, req), id);
  }

  /**
   * Replaces the item list.
   *
   * Not idempotency-keyed: `expectedRowVersion` already makes a repeat safe, and it says something an
   * idempotency key cannot — a second send of a stale list is a conflict, not a replay.
   */
  @Patch('prescriptions/:id')
  @RequirePermission('prescription.write')
  async edit(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: EditPrescriptionDto,
    @Req() req: FastifyRequest,
  ): Promise<PrescriptionView> {
    return this.svc.prescriptions.replaceItems(await this.actor(actor, tenant, req), id, {
      expectedRowVersion: dto.expectedRowVersion,
      items: dto.items.map((i) => ({
        sequence: i.sequence,
        medicationId: i.medicationId ?? null,
        medicationDatasetVersion: i.medicationDatasetVersion ?? null,
        catalogSnapshot: i.catalogSnapshot ?? null,
        freeTextName: i.freeTextName ?? null,
        isFreeText: i.isFreeText,
        strength: i.strength ?? null,
        dosageForm: i.dosageForm ?? null,
        route: i.route ?? null,
        dose: i.dose,
        frequency: i.frequency,
        duration: i.duration,
        quantity: i.quantity ?? null,
        timing: i.timing ?? null,
        instructions: i.instructions ?? null,
        instructionsBn: i.instructionsBn ?? null,
        substitutionAllowed: i.substitutionAllowed,
      })),
    });
  }

  @Post('prescriptions/:id/review')
  @HttpCode(200)
  @RequirePermission('prescription.review')
  @Idempotent()
  async review(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: RowVersionOnlyDto,
    @Req() req: FastifyRequest,
  ): Promise<PrescriptionView> {
    return this.svc.prescriptions.markReviewed(await this.actor(actor, tenant, req), id, {
      expectedRowVersion: dto.expectedRowVersion,
    });
  }

  @Post('prescriptions/:id/approve')
  @HttpCode(200)
  @RequirePermission('prescription.approve')
  @Idempotent()
  async approve(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: ApprovePrescriptionDto,
    @Req() req: FastifyRequest,
  ): Promise<PrescriptionView> {
    return this.svc.prescriptions.approve(await this.actor(actor, tenant, req), id, {
      expectedRowVersion: dto.expectedRowVersion,
      attestationVersion: dto.attestationVersion,
    });
  }

  @Post('prescriptions/:id/corrections')
  @HttpCode(201)
  @RequirePermission('prescription.write')
  @Idempotent()
  async startCorrection(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<PrescriptionView> {
    return this.svc.prescriptions.startCorrection(await this.actor(actor, tenant, req), id);
  }

  @Post('prescriptions/:id/void')
  @HttpCode(200)
  @RequirePermission('prescription.void')
  @Idempotent()
  async voidPrescription(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: VoidPrescriptionDto,
    @Req() req: FastifyRequest,
  ): Promise<PrescriptionView> {
    return this.svc.prescriptions.void(await this.actor(actor, tenant, req), id, {
      expectedRowVersion: dto.expectedRowVersion,
      reason: dto.reason,
      clinicalReviewerDoctorProfileId: dto.clinicalReviewerDoctorProfileId ?? null,
    });
  }
}
