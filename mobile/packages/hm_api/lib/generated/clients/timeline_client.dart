// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/get_api_v1_patients_id_timeline_response.dart';

part 'timeline_client.g.dart';

@RestApi()
abstract class TimelineClient {
  factory TimelineClient(Dio dio, {String? baseUrl}) = _TimelineClient;

  @GET('/api/v1/patients/{id}/timeline')
  Future<GetApiV1PatientsIdTimelineResponse> getPatientTimeline({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Query('cursor') String? cursor,
    @Header('X-Patient-Context') String? xPatientContext,
    @Query('limit') int? limit = 25,
  });
}
