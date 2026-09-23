import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { createZodDto } from 'nestjs-zod';
import type { ActorContext, TenantContext } from '@hmedic/kernel';
import {
  AddDiagnosisRequest,
  AddSymptomRequest,
  AmendNoteRequest,
  SaveNoteDraftRequest,
  SignNoteRequest,
  UpdateDiagnosisRequest,
  VoidDiagnosisRequest,
} from '@hmedic/contracts';
import { HTTP_RUNTIME, type HttpRuntime, Idempotent } from '@hmedic/http-kit';
import { CurrentActor, CurrentTenant, RequirePermission } from '@hmedic/identity-access/nest';
import { CLINICAL_SERVICES, type ClinicalServices } from '@hmedic/clinical/nest';
import type { DiagnosisView, NoteDraftView, NoteRevisionView, SymptomView } from '@hmedic/clinical';
import { clinicalActor, idempotencyKey } from './actor';

class SaveNoteDraftDto extends createZodDto(SaveNoteDraftRequest) {}
class SignNoteDto extends createZodDto(SignNoteRequest) {}
class AmendNoteDto extends createZodDto(AmendNoteRequest) {}
class AddDiagnosisDto extends createZodDto(AddDiagnosisRequest) {}
class UpdateDiagnosisDto extends createZodDto(UpdateDiagnosisRequest) {}
class VoidDiagnosisDto extends createZodDto(VoidDiagnosisRequest) {}
class AddSymptomDto extends createZodDto(AddSymptomRequest) {}

/**
 * Encounter notes, diagnoses and symptoms (CLIN-003, CLIN-004).
 *
 * The permissions here are the matrix's, and they are not interchangeable: `note.write` covers the draft,
 * which a nurse in the chamber may also edit, while `note.sign` is a doctor putting their name to a
 * record. The services enforce the second half of each rule — assignment or scope — because a permission
 * says what a role may do and assignment says to whose patient.
 */
@Controller('encounters')
export class EncounterNoteController {
  constructor(
    @Inject(CLINICAL_SERVICES) private readonly svc: ClinicalServices,
    @Inject(HTTP_RUNTIME) private readonly runtime: HttpRuntime,
  ) {}

  @Get(':id/note')
  @RequirePermission('encounter.read')
  async getNote(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
  ): Promise<NoteDraftView> {
    return this.svc.notes.getDraft(await clinicalActor(this.runtime, actor, tenant, req), id);
  }

  /**
   * Autosave. `PUT` because the draft is one addressable document that the client replaces, and it is
   * guarded by `expectedRowVersion` rather than by an idempotency key: two saves of different text are
   * two real edits, and the version is what decides which one is behind.
   */
  @Put(':id/note')
  @HttpCode(200)
  @RequirePermission('note.write')
  async saveNote(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SaveNoteDraftDto,
    @Req() req: FastifyRequest,
  ): Promise<NoteDraftView> {
    return this.svc.notes.saveDraft(await clinicalActor(this.runtime, actor, tenant, req), id, {
      expectedRowVersion: dto.expectedRowVersion,
      sections: dto.sections,
    });
  }

  @Post(':id/note/sign')
  @Idempotent()
  @RequirePermission('note.sign')
  async signNote(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SignNoteDto,
    @Req() req: FastifyRequest,
  ): Promise<NoteRevisionView> {
    return this.svc.notes.sign(
      await clinicalActor(this.runtime, actor, tenant, req),
      id,
      { expectedRowVersion: dto.expectedRowVersion },
      { idempotencyKey: idempotencyKey(req) },
    );
  }

  /** An amendment is a signature with a reason, so it runs the same use case. */
  @Post(':id/note/corrections')
  @Idempotent()
  @RequirePermission('note.sign')
  async amendNote(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AmendNoteDto,
    @Req() req: FastifyRequest,
  ): Promise<NoteRevisionView> {
    return this.svc.notes.sign(
      await clinicalActor(this.runtime, actor, tenant, req),
      id,
      { expectedRowVersion: dto.expectedRowVersion, correctionReason: dto.correctionReason },
      { idempotencyKey: idempotencyKey(req) },
    );
  }

  @Get(':id/note/revisions')
  @RequirePermission('encounter.read')
  async listRevisions(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
  ): Promise<NoteRevisionView[]> {
    return this.svc.notes.listRevisions(await clinicalActor(this.runtime, actor, tenant, req), id);
  }

  @Get(':id/diagnoses')
  @RequirePermission('encounter.read')
  async listDiagnoses(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
  ): Promise<DiagnosisView[]> {
    return this.svc.diagnoses.list(await clinicalActor(this.runtime, actor, tenant, req), id);
  }

  @Post(':id/diagnoses')
  @Idempotent()
  @RequirePermission('diagnosis.write')
  async addDiagnosis(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddDiagnosisDto,
    @Req() req: FastifyRequest,
  ): Promise<DiagnosisView> {
    return this.svc.diagnoses.add(await clinicalActor(this.runtime, actor, tenant, req), id, dto, {
      idempotencyKey: idempotencyKey(req),
    });
  }

  @Get(':id/symptoms')
  @RequirePermission('encounter.read')
  async listSymptoms(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
  ): Promise<SymptomView[]> {
    return this.svc.diagnoses.listSymptoms(await clinicalActor(this.runtime, actor, tenant, req), id);
  }

  @Post(':id/symptoms')
  @Idempotent()
  @RequirePermission('clinical.write')
  async addSymptom(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddSymptomDto,
    @Req() req: FastifyRequest,
  ): Promise<SymptomView> {
    return this.svc.diagnoses.addSymptom(await clinicalActor(this.runtime, actor, tenant, req), id, dto, {
      idempotencyKey: idempotencyKey(req),
    });
  }
}

/** Diagnoses addressed on their own, because editing and voiding act on the diagnosis, not the encounter. */
@Controller('diagnoses')
export class DiagnosisController {
  constructor(
    @Inject(CLINICAL_SERVICES) private readonly svc: ClinicalServices,
    @Inject(HTTP_RUNTIME) private readonly runtime: HttpRuntime,
  ) {}

  @Patch(':id')
  @HttpCode(200)
  @RequirePermission('diagnosis.write')
  async update(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateDiagnosisDto,
    @Req() req: FastifyRequest,
  ): Promise<DiagnosisView> {
    return this.svc.diagnoses.update(await clinicalActor(this.runtime, actor, tenant, req), id, dto);
  }

  @Post(':id/void')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission('diagnosis.write')
  async void(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VoidDiagnosisDto,
    @Req() req: FastifyRequest,
  ): Promise<DiagnosisView> {
    return this.svc.diagnoses.void(await clinicalActor(this.runtime, actor, tenant, req), id, dto, {
      idempotencyKey: idempotencyKey(req),
    });
  }
}
