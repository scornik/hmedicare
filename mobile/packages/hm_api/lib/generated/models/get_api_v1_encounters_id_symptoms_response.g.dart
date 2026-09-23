// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_encounters_id_symptoms_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1EncountersIdSymptomsResponse
_$GetApiV1EncountersIdSymptomsResponseFromJson(Map<String, dynamic> json) =>
    GetApiV1EncountersIdSymptomsResponse(
      data: (json['data'] as List<dynamic>)
          .map((e) => SymptomObservation.fromJson(e as Map<String, dynamic>))
          .toList(),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$GetApiV1EncountersIdSymptomsResponseToJson(
  GetApiV1EncountersIdSymptomsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
