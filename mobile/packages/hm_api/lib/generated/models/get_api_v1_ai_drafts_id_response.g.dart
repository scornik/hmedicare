// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_ai_drafts_id_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1AiDraftsIdResponse _$GetApiV1AiDraftsIdResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1AiDraftsIdResponse(
  data: AiDraft.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1AiDraftsIdResponseToJson(
  GetApiV1AiDraftsIdResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
