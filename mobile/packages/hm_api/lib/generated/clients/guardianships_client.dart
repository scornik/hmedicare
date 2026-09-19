// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/activate_guardianship_request.dart';
import '../models/end_guardianship_request.dart';
import '../models/get_api_v1_guardianships_response.dart';
import '../models/get_api_v1_patients_id_guardianships_response.dart';
import '../models/post_api_v1_guardianships_id_activate_response.dart';
import '../models/post_api_v1_guardianships_id_end_response.dart';
import '../models/post_api_v1_guardianships_id_revoke_response.dart';
import '../models/post_api_v1_patients_id_guardianships_response.dart';
import '../models/request_guardianship_request.dart';
import '../models/status.dart';

part 'guardianships_client.g.dart';

@RestApi()
abstract class GuardianshipsClient {
  factory GuardianshipsClient(Dio dio, {String? baseUrl}) = _GuardianshipsClient;

  @GET('/api/v1/guardianships')
  Future<GetApiV1GuardianshipsResponse> listGuardianships({
    @Header('X-Tenant-ID') required String xTenantId,
    @Query('status') Status? status,
    @Query('cursor') String? cursor,
    @Query('limit') int? limit,
  });

  @POST('/api/v1/guardianships/{id}/activate')
  Future<PostApiV1GuardianshipsIdActivateResponse> activateGuardianship({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() ActivateGuardianshipRequest? body,
  });

  @POST('/api/v1/guardianships/{id}/end')
  Future<PostApiV1GuardianshipsIdEndResponse> endGuardianship({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() EndGuardianshipRequest? body,
  });

  @POST('/api/v1/guardianships/{id}/revoke')
  Future<PostApiV1GuardianshipsIdRevokeResponse> revokeGuardianship({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() EndGuardianshipRequest? body,
  });

  @GET('/api/v1/patients/{id}/guardianships')
  Future<GetApiV1PatientsIdGuardianshipsResponse> listPatientGuardianships({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
  });

  /// Patient user (X-Tenant-ID, no patient context needed) or staff. Always PENDING until staff activate it.
  @POST('/api/v1/patients/{id}/guardianships')
  Future<PostApiV1PatientsIdGuardianshipsResponse> requestGuardianship({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() RequestGuardianshipRequest? body,
  });
}
