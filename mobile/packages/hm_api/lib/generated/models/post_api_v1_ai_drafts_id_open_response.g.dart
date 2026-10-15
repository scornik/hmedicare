// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_ai_drafts_id_open_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1AiDraftsIdOpenResponse _$PostApiV1AiDraftsIdOpenResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1AiDraftsIdOpenResponse(
  data: AiDraft.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1AiDraftsIdOpenResponseToJson(
  PostApiV1AiDraftsIdOpenResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
