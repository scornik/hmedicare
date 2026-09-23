// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_diagnoses_id_void_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1DiagnosesIdVoidResponse _$PostApiV1DiagnosesIdVoidResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1DiagnosesIdVoidResponse(
  data: Diagnosis.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1DiagnosesIdVoidResponseToJson(
  PostApiV1DiagnosesIdVoidResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
