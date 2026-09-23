// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_encounters_id_complete_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1EncountersIdCompleteResponse
_$PostApiV1EncountersIdCompleteResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1EncountersIdCompleteResponse(
      data: Encounter.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1EncountersIdCompleteResponseToJson(
  PostApiV1EncountersIdCompleteResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
