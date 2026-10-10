// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/get_api_v1_telemedicine_sessions_id_response.dart';
import '../models/post_api_v1_encounters_id_telemedicine_session_response.dart';
import '../models/post_api_v1_telemedicine_sessions_id_end_response.dart';
import '../models/post_api_v1_telemedicine_sessions_id_join_token_response.dart';

part 'telemedicine_client.g.dart';

@RestApi()
abstract class TelemedicineClient {
  factory TelemedicineClient(Dio dio, {String? baseUrl}) = _TelemedicineClient;

  @POST('/api/v1/encounters/{id}/telemedicine/session')
  Future<PostApiV1EncountersIdTelemedicineSessionResponse> createTelemedicineSession({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
  });

  @GET('/api/v1/telemedicine/sessions/{id}')
  Future<GetApiV1TelemedicineSessionsIdResponse> getTelemedicineSession({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('X-Patient-Context') String? xPatientContext,
  });

  @POST('/api/v1/telemedicine/sessions/{id}/end')
  Future<PostApiV1TelemedicineSessionsIdEndResponse> endTelemedicineSession({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
  });

  @POST('/api/v1/telemedicine/sessions/{id}/join-token')
  Future<PostApiV1TelemedicineSessionsIdJoinTokenResponse> issueTelemedicineJoinToken({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Header('X-Patient-Context') String? xPatientContext,
  });
}
