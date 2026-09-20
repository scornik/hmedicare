// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_appointments_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1AppointmentsResponse _$GetApiV1AppointmentsResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1AppointmentsResponse(
  data: AppointmentListResponse.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1AppointmentsResponseToJson(
  GetApiV1AppointmentsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
