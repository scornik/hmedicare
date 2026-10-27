// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/api_v1_lab_reports_id_results_request_body.dart';
import '../models/api_v1_lab_reports_id_review_request_body.dart';
import '../models/api_v1_lab_reports_id_share_request_body.dart';
import '../models/api_v1_lab_reports_request_body.dart';
import '../models/get_api_v1_lab_reports_by_encounter_encounter_id_response.dart';
import '../models/get_api_v1_lab_reports_id_response.dart';
import '../models/get_api_v1_lab_reports_patient_mine_id_response.dart';
import '../models/get_api_v1_lab_reports_patient_mine_response.dart';
import '../models/post_api_v1_lab_reports_id_results_response.dart';
import '../models/post_api_v1_lab_reports_id_review_response.dart';
import '../models/post_api_v1_lab_reports_id_share_response.dart';
import '../models/post_api_v1_lab_reports_response.dart';

part 'labs_client.g.dart';

@RestApi()
abstract class LabsClient {
  factory LabsClient(Dio dio, {String? baseUrl}) = _LabsClient;

  /// Attach structured lab metadata only to an AVAILABLE LAB_REPORT document.
  @POST('/api/v1/lab-reports')
  Future<PostApiV1LabReportsResponse> createLabReport({
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() ApiV1LabReportsRequestBody? body,
  });

  @GET('/api/v1/lab-reports/by-encounter/{encounterId}')
  Future<GetApiV1LabReportsByEncounterEncounterIdResponse> listEncounterLabReports({
    @Path('encounterId') required String encounterId,
    @Header('X-Tenant-ID') required String xTenantId,
  });

  /// Reviewed, explicitly shared lab reports for the active patient context.
  @GET('/api/v1/lab-reports/patient/mine')
  Future<GetApiV1LabReportsPatientMineResponse> listMyLabReports({
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('X-Patient-Context') required String xPatientContext,
  });

  @GET('/api/v1/lab-reports/patient/mine/{id}')
  Future<GetApiV1LabReportsPatientMineIdResponse> getMyLabReport({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('X-Patient-Context') required String xPatientContext,
  });

  @GET('/api/v1/lab-reports/{id}')
  Future<GetApiV1LabReportsIdResponse> getLabReport({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
  });

  @POST('/api/v1/lab-reports/{id}/results')
  Future<PostApiV1LabReportsIdResultsResponse> recordLabResult({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() ApiV1LabReportsIdResultsRequestBody? body,
  });

  @POST('/api/v1/lab-reports/{id}/review')
  Future<PostApiV1LabReportsIdReviewResponse> reviewLabReport({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() ApiV1LabReportsIdReviewRequestBody? body,
  });

  /// Doctor shares a reviewed lab report and its source document with the patient.
  @POST('/api/v1/lab-reports/{id}/share')
  Future<PostApiV1LabReportsIdShareResponse> shareLabReportWithPatient({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() ApiV1LabReportsIdShareRequestBody? body,
  });
}
