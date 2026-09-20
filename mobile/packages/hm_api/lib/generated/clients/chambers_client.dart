// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/create_chamber_request.dart';
import '../models/create_schedule_rule_request.dart';
import '../models/end_schedule_rule_request.dart';
import '../models/get_api_v1_chambers_id_response.dart';
import '../models/get_api_v1_chambers_id_schedule_rules_response.dart';
import '../models/get_api_v1_chambers_response.dart';
import '../models/patch_api_v1_chambers_id_response.dart';
import '../models/post_api_v1_chambers_id_schedule_rules_response.dart';
import '../models/post_api_v1_chambers_response.dart';
import '../models/post_api_v1_schedule_rules_id_end_response.dart';
import '../models/status2.dart';
import '../models/update_chamber_request.dart';

part 'chambers_client.g.dart';

@RestApi()
abstract class ChambersClient {
  factory ChambersClient(Dio dio, {String? baseUrl}) = _ChambersClient;

  @GET('/api/v1/chambers')
  Future<GetApiV1ChambersResponse> listChambers({
    @Header('X-Tenant-ID') required String xTenantId,
    @Query('clinicId') String? clinicId,
    @Query('doctorProfileId') String? doctorProfileId,
    @Query('status') Status2? status,
    @Header('X-Patient-Context') String? xPatientContext,
  });

  @POST('/api/v1/chambers')
  Future<PostApiV1ChambersResponse> createChamber({
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() CreateChamberRequest? body,
  });

  @GET('/api/v1/chambers/{id}')
  Future<GetApiV1ChambersIdResponse> getChamber({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('X-Patient-Context') String? xPatientContext,
  });

  @PATCH('/api/v1/chambers/{id}')
  Future<PatchApiV1ChambersIdResponse> updateChamber({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() UpdateChamberRequest? body,
  });

  @GET('/api/v1/chambers/{id}/schedule-rules')
  Future<GetApiV1ChambersIdScheduleRulesResponse> listScheduleRules({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
  });

  @POST('/api/v1/chambers/{id}/schedule-rules')
  Future<PostApiV1ChambersIdScheduleRulesResponse> createScheduleRule({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() CreateScheduleRuleRequest? body,
  });

  @POST('/api/v1/schedule-rules/{id}/end')
  Future<PostApiV1ScheduleRulesIdEndResponse> endScheduleRule({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() EndScheduleRuleRequest? body,
  });
}
