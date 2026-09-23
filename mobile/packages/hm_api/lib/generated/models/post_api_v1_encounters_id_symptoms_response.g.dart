// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_encounters_id_symptoms_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1EncountersIdSymptomsResponse
_$PostApiV1EncountersIdSymptomsResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1EncountersIdSymptomsResponse(
      data: SymptomObservation.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1EncountersIdSymptomsResponseToJson(
  PostApiV1EncountersIdSymptomsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
