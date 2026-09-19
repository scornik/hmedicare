// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_patients_id_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1PatientsIdResponse _$GetApiV1PatientsIdResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1PatientsIdResponse(
  data: Patient.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1PatientsIdResponseToJson(
  GetApiV1PatientsIdResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
