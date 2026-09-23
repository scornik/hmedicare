// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/add_diagnosis_request.dart';
import '../models/add_symptom_request.dart';
import '../models/amend_note_request.dart';
import '../models/api_v1_encounters_id_complete_request_body.dart';
import '../models/api_v1_encounters_id_resume_request_body.dart';
import '../models/enter_encounter_in_error_request.dart';
import '../models/get_api_v1_encounters_id_diagnoses_response.dart';
import '../models/get_api_v1_encounters_id_note_response.dart';
import '../models/get_api_v1_encounters_id_note_revisions_response.dart';
import '../models/get_api_v1_encounters_id_response.dart';
import '../models/get_api_v1_encounters_id_symptoms_response.dart';
import '../models/get_api_v1_patients_id_encounters_response.dart';
import '../models/interrupt_encounter_request.dart';
import '../models/patch_api_v1_diagnoses_id_response.dart';
import '../models/post_api_v1_diagnoses_id_void_response.dart';
import '../models/post_api_v1_encounters_id_complete_response.dart';
import '../models/post_api_v1_encounters_id_diagnoses_response.dart';
import '../models/post_api_v1_encounters_id_entered_in_error_response.dart';
import '../models/post_api_v1_encounters_id_interrupt_response.dart';
import '../models/post_api_v1_encounters_id_note_corrections_response.dart';
import '../models/post_api_v1_encounters_id_note_sign_response.dart';
import '../models/post_api_v1_encounters_id_resume_response.dart';
import '../models/post_api_v1_encounters_id_symptoms_response.dart';
import '../models/post_api_v1_serials_id_encounter_response.dart';
import '../models/put_api_v1_encounters_id_note_response.dart';
import '../models/save_note_draft_request.dart';
import '../models/sign_note_request.dart';
import '../models/start_encounter_request.dart';
import '../models/update_diagnosis_request.dart';
import '../models/void_diagnosis_request.dart';

part 'encounters_client.g.dart';

@RestApi()
abstract class EncountersClient {
  factory EncountersClient(Dio dio, {String? baseUrl}) = _EncountersClient;

  @PATCH('/api/v1/diagnoses/{id}')
  Future<PatchApiV1DiagnosesIdResponse> updateDiagnosis({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Body() UpdateDiagnosisRequest? body,
  });

  @POST('/api/v1/diagnoses/{id}/void')
  Future<PostApiV1DiagnosesIdVoidResponse> voidDiagnosis({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() VoidDiagnosisRequest? body,
  });

  @GET('/api/v1/encounters/{id}')
  Future<GetApiV1EncountersIdResponse> getEncounter({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
  });

  @POST('/api/v1/encounters/{id}/complete')
  Future<PostApiV1EncountersIdCompleteResponse> completeEncounter({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() ApiV1EncountersIdCompleteRequestBody? body,
  });

  @GET('/api/v1/encounters/{id}/diagnoses')
  Future<GetApiV1EncountersIdDiagnosesResponse> listEncounterDiagnoses({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
  });

  @POST('/api/v1/encounters/{id}/diagnoses')
  Future<PostApiV1EncountersIdDiagnosesResponse> addEncounterDiagnosis({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() AddDiagnosisRequest? body,
  });

  @POST('/api/v1/encounters/{id}/entered-in-error')
  Future<PostApiV1EncountersIdEnteredInErrorResponse> enterEncounterInError({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() EnterEncounterInErrorRequest? body,
  });

  @POST('/api/v1/encounters/{id}/interrupt')
  Future<PostApiV1EncountersIdInterruptResponse> interruptEncounter({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() InterruptEncounterRequest? body,
  });

  @GET('/api/v1/encounters/{id}/note')
  Future<GetApiV1EncountersIdNoteResponse> getEncounterNote({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
  });

  @PUT('/api/v1/encounters/{id}/note')
  Future<PutApiV1EncountersIdNoteResponse> saveEncounterNoteDraft({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Body() SaveNoteDraftRequest? body,
  });

  @POST('/api/v1/encounters/{id}/note/corrections')
  Future<PostApiV1EncountersIdNoteCorrectionsResponse> amendEncounterNote({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() AmendNoteRequest? body,
  });

  @GET('/api/v1/encounters/{id}/note/revisions')
  Future<GetApiV1EncountersIdNoteRevisionsResponse> listEncounterNoteRevisions({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
  });

  @POST('/api/v1/encounters/{id}/note/sign')
  Future<PostApiV1EncountersIdNoteSignResponse> signEncounterNote({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() SignNoteRequest? body,
  });

  @POST('/api/v1/encounters/{id}/resume')
  Future<PostApiV1EncountersIdResumeResponse> resumeEncounter({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() ApiV1EncountersIdResumeRequestBody? body,
  });

  @GET('/api/v1/encounters/{id}/symptoms')
  Future<GetApiV1EncountersIdSymptomsResponse> listEncounterSymptoms({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
  });

  @POST('/api/v1/encounters/{id}/symptoms')
  Future<PostApiV1EncountersIdSymptomsResponse> addEncounterSymptom({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() AddSymptomRequest? body,
  });

  @GET('/api/v1/patients/{id}/encounters')
  Future<GetApiV1PatientsIdEncountersResponse> listPatientEncounters({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Query('limit') int? limit,
    @Query('excludeEncounterId') String? excludeEncounterId,
  });

  @POST('/api/v1/serials/{id}/encounter')
  Future<PostApiV1SerialsIdEncounterResponse> startEncounter({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() StartEncounterRequest? body,
  });
}
