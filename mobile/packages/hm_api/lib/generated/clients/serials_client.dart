// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/call_serial_request.dart';
import '../models/cancel_serial_request.dart';
import '../models/check_in_request.dart';
import '../models/get_api_v1_me_serials_id_response.dart';
import '../models/get_api_v1_me_serials_response.dart';
import '../models/get_api_v1_serials_id_response.dart';
import '../models/post_api_v1_serials_id_call_response.dart';
import '../models/post_api_v1_serials_id_cancel_response.dart';
import '../models/post_api_v1_serials_id_check_in_response.dart';
import '../models/post_api_v1_serials_id_confirm_response.dart';
import '../models/post_api_v1_serials_id_mark_waiting_response.dart';
import '../models/post_api_v1_serials_id_no_show_response.dart';
import '../models/post_api_v1_serials_id_recall_response.dart';
import '../models/post_api_v1_serials_id_remote_ready_response.dart';
import '../models/post_api_v1_serials_id_reschedule_response.dart';
import '../models/post_api_v1_serials_id_skip_response.dart';
import '../models/reschedule_serial_request.dart';
import '../models/row_version_only_request.dart';
import '../models/skip_serial_request.dart';

part 'serials_client.g.dart';

@RestApi()
abstract class SerialsClient {
  factory SerialsClient(Dio dio, {String? baseUrl}) = _SerialsClient;

  @GET('/api/v1/me/serials')
  Future<GetApiV1MeSerialsResponse> listMySerials({
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('X-Patient-Context') required String xPatientContext,
    @Query('limit') int? limit,
  });

  @GET('/api/v1/me/serials/{id}')
  Future<GetApiV1MeSerialsIdResponse> getMySerial({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('X-Patient-Context') required String xPatientContext,
  });

  @GET('/api/v1/serials/{id}')
  Future<GetApiV1SerialsIdResponse> getSerial({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
  });

  @POST('/api/v1/serials/{id}/call')
  Future<PostApiV1SerialsIdCallResponse> callSerial({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() CallSerialRequest? body,
  });

  @POST('/api/v1/serials/{id}/cancel')
  Future<PostApiV1SerialsIdCancelResponse> cancelSerial({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Header('X-Patient-Context') String? xPatientContext,
    @Body() CancelSerialRequest? body,
  });

  @POST('/api/v1/serials/{id}/check-in')
  Future<PostApiV1SerialsIdCheckInResponse> checkInSerial({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Header('X-Patient-Context') String? xPatientContext,
    @Body() CheckInRequest? body,
  });

  @POST('/api/v1/serials/{id}/confirm')
  Future<PostApiV1SerialsIdConfirmResponse> confirmSerial({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Header('X-Patient-Context') String? xPatientContext,
    @Body() RowVersionOnlyRequest? body,
  });

  @POST('/api/v1/serials/{id}/mark-waiting')
  Future<PostApiV1SerialsIdMarkWaitingResponse> markWaiting({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() RowVersionOnlyRequest? body,
  });

  @POST('/api/v1/serials/{id}/no-show')
  Future<PostApiV1SerialsIdNoShowResponse> markNoShow({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() RowVersionOnlyRequest? body,
  });

  @POST('/api/v1/serials/{id}/recall')
  Future<PostApiV1SerialsIdRecallResponse> recallSerial({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() RowVersionOnlyRequest? body,
  });

  @POST('/api/v1/serials/{id}/remote-ready')
  Future<PostApiV1SerialsIdRemoteReadyResponse> markRemoteReady({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Header('X-Patient-Context') String? xPatientContext,
    @Body() RowVersionOnlyRequest? body,
  });

  @POST('/api/v1/serials/{id}/reschedule')
  Future<PostApiV1SerialsIdRescheduleResponse> rescheduleSerial({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Header('X-Patient-Context') String? xPatientContext,
    @Body() RescheduleSerialRequest? body,
  });

  @POST('/api/v1/serials/{id}/skip')
  Future<PostApiV1SerialsIdSkipResponse> skipSerial({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() SkipSerialRequest? body,
  });
}
