// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_ai_suggestions_id_approve_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1AiSuggestionsIdApproveResponse
_$PostApiV1AiSuggestionsIdApproveResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1AiSuggestionsIdApproveResponse(
      data: AiApproval.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1AiSuggestionsIdApproveResponseToJson(
  PostApiV1AiSuggestionsIdApproveResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
