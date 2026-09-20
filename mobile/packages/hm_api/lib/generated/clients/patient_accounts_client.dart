// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/api_v1_patient_accounts_id_revoke_request_body.dart';
import '../models/get_api_v1_patient_accounts_response.dart';
import '../models/patient_account_link_request.dart';
import '../models/post_api_v1_patient_accounts_id_revoke_response.dart';
import '../models/post_api_v1_patient_accounts_id_verify_response.dart';
import '../models/post_api_v1_patient_accounts_link_requests_response.dart';
import '../models/status5.dart';
import '../models/verify_patient_account_request.dart';

part 'patient_accounts_client.g.dart';

@RestApi()
abstract class PatientAccountsClient {
  factory PatientAccountsClient(Dio dio, {String? baseUrl}) = _PatientAccountsClient;

  @GET('/api/v1/patient-accounts')
  Future<GetApiV1PatientAccountsResponse> listPatientAccounts({
    @Header('X-Tenant-ID') required String xTenantId,
    @Query('status') Status5? status,
    @Query('cursor') String? cursor,
    @Query('limit') int? limit,
  });

  /// Patient user (OTP-authenticated, no tenant header): asks a tenant to link this login to a patient record (PENDING).
  @POST('/api/v1/patient-accounts/link-requests')
  Future<PostApiV1PatientAccountsLinkRequestsResponse> requestPatientAccountLink({
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() PatientAccountLinkRequest? body,
  });

  @POST('/api/v1/patient-accounts/{id}/revoke')
  Future<PostApiV1PatientAccountsIdRevokeResponse> revokePatientAccount({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() ApiV1PatientAccountsIdRevokeRequestBody? body,
  });

  @POST('/api/v1/patient-accounts/{id}/verify')
  Future<PostApiV1PatientAccountsIdVerifyResponse> verifyPatientAccount({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() VerifyPatientAccountRequest? body,
  });
}
