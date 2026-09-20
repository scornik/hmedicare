// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/create_merge_case_request.dart';
import '../models/create_patient_request.dart';
import '../models/duplicate_check_request.dart';
import '../models/get_api_v1_merge_cases_response.dart';
import '../models/get_api_v1_patients_id_consents_response.dart';
import '../models/get_api_v1_patients_id_response.dart';
import '../models/get_api_v1_patients_response.dart';
import '../models/grant_consent_request.dart';
import '../models/patch_api_v1_patients_id_response.dart';
import '../models/post_api_v1_consents_id_withdraw_response.dart';
import '../models/post_api_v1_merge_cases_id_approve_response.dart';
import '../models/post_api_v1_merge_cases_id_reject_response.dart';
import '../models/post_api_v1_patients_duplicate_check_response.dart';
import '../models/post_api_v1_patients_id_consents_response.dart';
import '../models/post_api_v1_patients_id_merge_cases_response.dart';
import '../models/post_api_v1_patients_response.dart';
import '../models/review_merge_case_request.dart';
import '../models/status4.dart';
import '../models/update_patient_request.dart';
import '../models/withdraw_consent_request.dart';

part 'patients_client.g.dart';

@RestApi()
abstract class PatientsClient {
  factory PatientsClient(Dio dio, {String? baseUrl}) = _PatientsClient;

  @POST('/api/v1/consents/{id}/withdraw')
  Future<PostApiV1ConsentsIdWithdrawResponse> withdrawConsent({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Header('X-Patient-Context') String? xPatientContext,
    @Body() WithdrawConsentRequest? body,
  });

  @GET('/api/v1/merge-cases')
  Future<GetApiV1MergeCasesResponse> listMergeCases({
    @Header('X-Tenant-ID') required String xTenantId,
    @Query('status') Status4? status,
    @Query('cursor') String? cursor,
    @Query('limit') int? limit,
  });

  /// Re-points appointments and serials to the target, marks the source MERGED with merged_into; audited with every re-pointed id (audit C-47).
  @POST('/api/v1/merge-cases/{id}/approve')
  Future<PostApiV1MergeCasesIdApproveResponse> approveMergeCase({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() ReviewMergeCaseRequest? body,
  });

  @POST('/api/v1/merge-cases/{id}/reject')
  Future<PostApiV1MergeCasesIdRejectResponse> rejectMergeCase({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() ReviewMergeCaseRequest? body,
  });

  /// Search by name (Bangla/Banglish/English tokens), phone or MRN. Merged patients are excluded. Bounded, keyset-paginated.
  @GET('/api/v1/patients')
  Future<GetApiV1PatientsResponse> searchPatients({
    @Header('X-Tenant-ID') required String xTenantId,
    @Query('query') String? query,
    @Query('phone') String? phone,
    @Query('mrn') String? mrn,
    @Query('cursor') String? cursor,
    @Query('limit') int? limit,
  });

  /// 409 DUPLICATE_PATIENT_REVIEW_REQUIRED carries details.candidateIds (comma-separated); repeat with duplicateReview to confirm a new patient.
  @POST('/api/v1/patients')
  Future<PostApiV1PatientsResponse> createPatient({
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() CreatePatientRequest? body,
  });

  @POST('/api/v1/patients/duplicate-check')
  Future<PostApiV1PatientsDuplicateCheckResponse> checkDuplicatePatients({
    @Header('X-Tenant-ID') required String xTenantId,
    @Body() DuplicateCheckRequest? body,
  });

  @GET('/api/v1/patients/{id}')
  Future<GetApiV1PatientsIdResponse> getPatient({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('X-Patient-Context') String? xPatientContext,
  });

  @PATCH('/api/v1/patients/{id}')
  Future<PatchApiV1PatientsIdResponse> updatePatient({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Body() UpdatePatientRequest? body,
  });

  @GET('/api/v1/patients/{id}/consents')
  Future<GetApiV1PatientsIdConsentsResponse> listConsents({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('X-Patient-Context') String? xPatientContext,
  });

  @POST('/api/v1/patients/{id}/consents')
  Future<PostApiV1PatientsIdConsentsResponse> grantConsent({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Header('X-Patient-Context') String? xPatientContext,
    @Body() GrantConsentRequest? body,
  });

  /// Opens a merge review with {id} as the source (patient.merge). Nothing is merged yet.
  @POST('/api/v1/patients/{id}/merge-cases')
  Future<PostApiV1PatientsIdMergeCasesResponse> createMergeCase({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() CreateMergeCaseRequest? body,
  });
}
