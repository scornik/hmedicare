// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/cancel_chamber_day_request.dart';
import '../models/get_api_v1_chamber_days_id_availability_response.dart';
import '../models/get_api_v1_chamber_days_id_response.dart';
import '../models/get_api_v1_chamber_days_response.dart';
import '../models/materialize_chamber_day_request.dart';
import '../models/post_api_v1_chamber_days_id_cancel_response.dart';
import '../models/post_api_v1_chamber_days_id_close_response.dart';
import '../models/post_api_v1_chamber_days_id_delay_response.dart';
import '../models/post_api_v1_chamber_days_id_open_response.dart';
import '../models/post_api_v1_chamber_days_id_pause_response.dart';
import '../models/post_api_v1_chamber_days_response.dart';
import '../models/put_api_v1_chamber_days_id_queue_policy_response.dart';
import '../models/record_delay_request.dart';
import '../models/row_version_only_request.dart';
import '../models/update_chamber_day_policy_request.dart';

part 'chamber_days_client.g.dart';

@RestApi()
abstract class ChamberDaysClient {
  factory ChamberDaysClient(Dio dio, {String? baseUrl}) = _ChamberDaysClient;

  @GET('/api/v1/chamber-days')
  Future<GetApiV1ChamberDaysResponse> listChamberDays({
    @Query('from') required String from,
    @Query('to') required String to,
    @Header('X-Tenant-ID') required String xTenantId,
    @Query('chamberId') String? chamberId,
    @Query('doctorProfileId') String? doctorProfileId,
  });

  @POST('/api/v1/chamber-days')
  Future<PostApiV1ChamberDaysResponse> materializeChamberDay({
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() MaterializeChamberDayRequest? body,
  });

  @GET('/api/v1/chamber-days/{id}')
  Future<GetApiV1ChamberDaysIdResponse> getChamberDay({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('X-Patient-Context') String? xPatientContext,
  });

  @GET('/api/v1/chamber-days/{id}/availability')
  Future<GetApiV1ChamberDaysIdAvailabilityResponse> getChamberDayAvailability({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('X-Patient-Context') String? xPatientContext,
  });

  @POST('/api/v1/chamber-days/{id}/cancel')
  Future<PostApiV1ChamberDaysIdCancelResponse> cancelChamberDay({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() CancelChamberDayRequest? body,
  });

  @POST('/api/v1/chamber-days/{id}/close')
  Future<PostApiV1ChamberDaysIdCloseResponse> closeChamberDay({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() RowVersionOnlyRequest? body,
  });

  @POST('/api/v1/chamber-days/{id}/delay')
  Future<PostApiV1ChamberDaysIdDelayResponse> recordChamberDelay({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() RecordDelayRequest? body,
  });

  @POST('/api/v1/chamber-days/{id}/open')
  Future<PostApiV1ChamberDaysIdOpenResponse> openChamberDay({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() RowVersionOnlyRequest? body,
  });

  @POST('/api/v1/chamber-days/{id}/pause')
  Future<PostApiV1ChamberDaysIdPauseResponse> pauseChamberDay({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() RowVersionOnlyRequest? body,
  });

  @PUT('/api/v1/chamber-days/{id}/queue-policy')
  Future<PutApiV1ChamberDaysIdQueuePolicyResponse> updateChamberDayPolicy({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() UpdateChamberDayPolicyRequest? body,
  });
}
