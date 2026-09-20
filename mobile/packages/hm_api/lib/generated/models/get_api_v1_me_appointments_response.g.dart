// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_me_appointments_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1MeAppointmentsResponse _$GetApiV1MeAppointmentsResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1MeAppointmentsResponse(
  data: AppointmentListResponse.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1MeAppointmentsResponseToJson(
  GetApiV1MeAppointmentsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
