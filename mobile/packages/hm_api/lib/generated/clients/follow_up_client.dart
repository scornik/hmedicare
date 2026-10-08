// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/api_v1_encounters_id_follow_ups_request_body.dart';
import '../models/api_v1_follow_ups_id_book_request_body.dart';
import '../models/api_v1_follow_ups_id_request_body.dart';
import '../models/get_api_v1_encounters_id_follow_ups_response.dart';
import '../models/patch_api_v1_follow_ups_id_response.dart';
import '../models/post_api_v1_encounters_id_follow_ups_response.dart';
import '../models/post_api_v1_follow_ups_id_book_response.dart';

part 'follow_up_client.g.dart';

@RestApi()
abstract class FollowUpClient {
  factory FollowUpClient(Dio dio, {String? baseUrl}) = _FollowUpClient;

  @GET('/api/v1/encounters/{id}/follow-ups')
  Future<GetApiV1EncountersIdFollowUpsResponse> listEncounterFollowUps({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') String? idempotencyKey,
    @Header('X-Patient-Context') String? xPatientContext,
  });

  @POST('/api/v1/encounters/{id}/follow-ups')
  Future<PostApiV1EncountersIdFollowUpsResponse> createFollowUp({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Header('X-Patient-Context') String? xPatientContext,
    @Body() ApiV1EncountersIdFollowUpsRequestBody? body,
  });

  @PATCH('/api/v1/follow-ups/{id}')
  Future<PatchApiV1FollowUpsIdResponse> updateFollowUp({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') String? idempotencyKey,
    @Header('X-Patient-Context') String? xPatientContext,
    @Body() ApiV1FollowUpsIdRequestBody? body,
  });

  @POST('/api/v1/follow-ups/{id}/book')
  Future<PostApiV1FollowUpsIdBookResponse> bookFollowUp({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Header('X-Patient-Context') String? xPatientContext,
    @Body() ApiV1FollowUpsIdBookRequestBody? body,
  });
}
