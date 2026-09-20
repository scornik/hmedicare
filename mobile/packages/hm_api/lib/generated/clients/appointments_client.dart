// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/cancel_appointment_request.dart';
import '../models/create_appointment_request.dart';
import '../models/get_api_v1_appointments_id_response.dart';
import '../models/get_api_v1_appointments_response.dart';
import '../models/get_api_v1_me_appointments_response.dart';
import '../models/post_api_v1_appointments_id_cancel_response.dart';
import '../models/post_api_v1_appointments_response.dart';
import '../models/status.dart';

part 'appointments_client.g.dart';

@RestApi()
abstract class AppointmentsClient {
  factory AppointmentsClient(Dio dio, {String? baseUrl}) = _AppointmentsClient;

  @GET('/api/v1/appointments')
  Future<GetApiV1AppointmentsResponse> listAppointments({
    @Header('X-Tenant-ID') required String xTenantId,
    @Query('chamberDayId') String? chamberDayId,
    @Query('patientId') String? patientId,
    @Query('status') Status? status,
    @Query('cursor') String? cursor,
    @Query('limit') int? limit,
  });

  @POST('/api/v1/appointments')
  Future<PostApiV1AppointmentsResponse> createAppointment({
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Header('X-Patient-Context') String? xPatientContext,
    @Body() CreateAppointmentRequest? body,
  });

  @GET('/api/v1/appointments/{id}')
  Future<GetApiV1AppointmentsIdResponse> getAppointment({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('X-Patient-Context') String? xPatientContext,
  });

  @POST('/api/v1/appointments/{id}/cancel')
  Future<PostApiV1AppointmentsIdCancelResponse> cancelAppointment({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Header('X-Patient-Context') String? xPatientContext,
    @Body() CancelAppointmentRequest? body,
  });

  @GET('/api/v1/me/appointments')
  Future<GetApiV1MeAppointmentsResponse> listMyAppointments({
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('X-Patient-Context') required String xPatientContext,
    @Query('cursor') String? cursor,
    @Query('limit') int? limit,
  });
}
