// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_encounters_id_ai_note_draft_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1EncountersIdAiNoteDraftResponse
_$PostApiV1EncountersIdAiNoteDraftResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1EncountersIdAiNoteDraftResponse(
      data: AiJob.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1EncountersIdAiNoteDraftResponseToJson(
  PostApiV1EncountersIdAiNoteDraftResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
