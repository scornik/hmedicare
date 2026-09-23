// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_encounters_id_resume_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1EncountersIdResumeResponse
_$PostApiV1EncountersIdResumeResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1EncountersIdResumeResponse(
      data: Encounter.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1EncountersIdResumeResponseToJson(
  PostApiV1EncountersIdResumeResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
