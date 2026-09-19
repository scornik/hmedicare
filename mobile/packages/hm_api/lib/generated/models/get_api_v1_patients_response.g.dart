// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_patients_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1PatientsResponse _$GetApiV1PatientsResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1PatientsResponse(
  data: PatientSearchResponse.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1PatientsResponseToJson(
  GetApiV1PatientsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
