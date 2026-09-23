// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_encounters_id_diagnoses_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1EncountersIdDiagnosesResponse
_$PostApiV1EncountersIdDiagnosesResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1EncountersIdDiagnosesResponse(
      data: Diagnosis.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1EncountersIdDiagnosesResponseToJson(
  PostApiV1EncountersIdDiagnosesResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
