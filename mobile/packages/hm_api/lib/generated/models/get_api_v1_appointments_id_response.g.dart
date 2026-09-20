// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_appointments_id_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1AppointmentsIdResponse _$GetApiV1AppointmentsIdResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1AppointmentsIdResponse(
  data: Appointment.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1AppointmentsIdResponseToJson(
  GetApiV1AppointmentsIdResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
