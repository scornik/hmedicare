// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_appointments_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1AppointmentsResponse _$PostApiV1AppointmentsResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1AppointmentsResponse(
  data: Appointment.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1AppointmentsResponseToJson(
  PostApiV1AppointmentsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
