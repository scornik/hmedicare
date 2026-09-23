// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'patch_api_v1_diagnoses_id_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PatchApiV1DiagnosesIdResponse _$PatchApiV1DiagnosesIdResponseFromJson(
  Map<String, dynamic> json,
) => PatchApiV1DiagnosesIdResponse(
  data: Diagnosis.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PatchApiV1DiagnosesIdResponseToJson(
  PatchApiV1DiagnosesIdResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
