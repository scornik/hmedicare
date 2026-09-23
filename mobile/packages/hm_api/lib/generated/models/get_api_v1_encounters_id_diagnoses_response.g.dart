// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_encounters_id_diagnoses_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1EncountersIdDiagnosesResponse
_$GetApiV1EncountersIdDiagnosesResponseFromJson(Map<String, dynamic> json) =>
    GetApiV1EncountersIdDiagnosesResponse(
      data: (json['data'] as List<dynamic>)
          .map((e) => Diagnosis.fromJson(e as Map<String, dynamic>))
          .toList(),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$GetApiV1EncountersIdDiagnosesResponseToJson(
  GetApiV1EncountersIdDiagnosesResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
