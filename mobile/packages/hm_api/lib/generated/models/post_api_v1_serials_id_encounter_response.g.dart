// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_serials_id_encounter_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1SerialsIdEncounterResponse
_$PostApiV1SerialsIdEncounterResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1SerialsIdEncounterResponse(
      data: Encounter.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1SerialsIdEncounterResponseToJson(
  PostApiV1SerialsIdEncounterResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
