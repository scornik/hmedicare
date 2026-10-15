// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_ai_drafts_id_close_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1AiDraftsIdCloseResponse _$PostApiV1AiDraftsIdCloseResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1AiDraftsIdCloseResponse(
  data: AiDraft.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1AiDraftsIdCloseResponseToJson(
  PostApiV1AiDraftsIdCloseResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
