// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'dart:convert';
import 'dart:io';

import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/document_upload_request.dart';
import '../models/get_api_v1_documents_by_encounter_encounter_id_response.dart';
import '../models/get_api_v1_documents_id_response.dart';
import '../models/get_api_v1_documents_patient_upload_encounters_response.dart';
import '../models/get_api_v1_documents_upload_capability_response.dart';
import '../models/post_api_v1_documents_id_download_token_response.dart';
import '../models/post_api_v1_documents_upload_sessions_response.dart';
import '../models/post_api_v1_documents_upload_sessions_session_id_abort_response.dart';
import '../models/post_api_v1_documents_upload_sessions_session_id_finalize_response.dart';
import '../models/put_api_v1_documents_upload_sessions_session_id_parts_part_number_response.dart';

part 'documents_client.g.dart';

@RestApi()
abstract class DocumentsClient {
  factory DocumentsClient(Dio dio, {String? baseUrl}) = _DocumentsClient;

  /// Lists available clinical documents for an authorized encounter. Audit-only, redacted and mismatched-patient records are excluded.
  @GET('/api/v1/documents/by-encounter/{encounterId}')
  Future<GetApiV1DocumentsByEncounterEncounterIdResponse> listEncounterDocuments({
    @Path('encounterId') required String encounterId,
    @Header('X-Tenant-ID') required String xTenantId,
    @Query('page') int? page,
  });

  /// Recent encounters the active patient context may attach an upload to.
  @GET('/api/v1/documents/patient/upload-encounters')
  Future<GetApiV1DocumentsPatientUploadEncountersResponse> listPatientUploadEncounters({
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('X-Patient-Context') required String xPatientContext,
  });

  @GET('/api/v1/documents/upload-capability')
  Future<GetApiV1DocumentsUploadCapabilityResponse> getDocumentUploadCapability({
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('X-Patient-Context') String? xPatientContext,
  });

  /// Create an upload for an authorized encounter. Patient contexts need UPLOAD_DOCUMENTS.
  @POST('/api/v1/documents/upload-sessions')
  Future<PostApiV1DocumentsUploadSessionsResponse> createDocumentUploadSession({
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Header('X-Patient-Context') String? xPatientContext,
    @Body() DocumentUploadRequest? body,
  });

  @POST('/api/v1/documents/upload-sessions/{sessionId}/abort')
  Future<PostApiV1DocumentsUploadSessionsSessionIdAbortResponse> abortDocumentUpload({
    @Path('sessionId') required String sessionId,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Header('X-Patient-Context') String? xPatientContext,
  });

  @POST('/api/v1/documents/upload-sessions/{sessionId}/finalize')
  Future<PostApiV1DocumentsUploadSessionsSessionIdFinalizeResponse> finalizeDocumentUpload({
    @Path('sessionId') required String sessionId,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Header('X-Patient-Context') String? xPatientContext,
  });

  @PUT('/api/v1/documents/upload-sessions/{sessionId}/parts/{partNumber}')
  Future<PutApiV1DocumentsUploadSessionsSessionIdPartsPartNumberResponse> uploadDocumentPart({
    @Path('sessionId') required String sessionId,
    @Path('partNumber') required int partNumber,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('X-Part-SHA256') required String xPartSha256,
    @Body() required File body,
    @Header('X-Patient-Context') String? xPatientContext,
  });

  /// Returns the current processing state of a clinical document for an authorized encounter.
  @GET('/api/v1/documents/{id}')
  Future<GetApiV1DocumentsIdResponse> getDocumentMetadata({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
  });

  /// Streams the revision the token was issued for. The token is spent on use, so a saved link does not work twice, and every rejection answers identically so a caller cannot probe for a valid one.
  @GET('/api/v1/documents/{id}/download')
  @DioResponseType(ResponseType.stream)
  Stream<String> downloadDocument({
    @Path('id') required String id,
    @Query('token') required String token,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('X-Patient-Context') String? xPatientContext,
  });

  /// Re-checks authorization and returns a single-use token for the current revision. Refused with DOCUMENT_NOT_AVAILABLE unless the document is AVAILABLE.
  @POST('/api/v1/documents/{id}/download-token')
  Future<PostApiV1DocumentsIdDownloadTokenResponse> createDocumentDownloadToken({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Header('X-Patient-Context') String? xPatientContext,
  });
}
