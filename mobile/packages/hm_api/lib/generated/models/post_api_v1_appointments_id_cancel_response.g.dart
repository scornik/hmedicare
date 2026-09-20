// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_appointments_id_cancel_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1AppointmentsIdCancelResponse
_$PostApiV1AppointmentsIdCancelResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1AppointmentsIdCancelResponse(
      data: Appointment.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1AppointmentsIdCancelResponseToJson(
  PostApiV1AppointmentsIdCancelResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
