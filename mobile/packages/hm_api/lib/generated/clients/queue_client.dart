// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/get_api_v1_chamber_days_id_queue_response.dart';
import '../models/issue_walk_in_request.dart';
import '../models/post_api_v1_chamber_days_id_reorder_response.dart';
import '../models/post_api_v1_chamber_days_id_walk_ins_response.dart';
import '../models/reorder_queue_request.dart';

part 'queue_client.g.dart';

@RestApi()
abstract class QueueClient {
  factory QueueClient(Dio dio, {String? baseUrl}) = _QueueClient;

  @GET('/api/v1/chamber-days/{id}/queue')
  Future<GetApiV1ChamberDaysIdQueueResponse> getQueue({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('If-None-Match') String? ifNoneMatch,
  });

  @POST('/api/v1/chamber-days/{id}/reorder')
  Future<PostApiV1ChamberDaysIdReorderResponse> reorderQueue({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() ReorderQueueRequest? body,
  });

  @POST('/api/v1/chamber-days/{id}/walk-ins')
  Future<PostApiV1ChamberDaysIdWalkInsResponse> issueWalkInSerial({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() IssueWalkInRequest? body,
  });
}
