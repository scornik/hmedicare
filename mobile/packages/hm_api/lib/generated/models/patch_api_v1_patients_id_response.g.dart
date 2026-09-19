// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'patch_api_v1_patients_id_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PatchApiV1PatientsIdResponse _$PatchApiV1PatientsIdResponseFromJson(
  Map<String, dynamic> json,
) => PatchApiV1PatientsIdResponse(
  data: Patient.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PatchApiV1PatientsIdResponseToJson(
  PatchApiV1PatientsIdResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
