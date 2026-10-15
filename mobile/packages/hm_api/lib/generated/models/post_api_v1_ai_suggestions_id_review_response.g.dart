// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_ai_suggestions_id_review_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1AiSuggestionsIdReviewResponse
_$PostApiV1AiSuggestionsIdReviewResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1AiSuggestionsIdReviewResponse(
      data: AiSuggestion.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1AiSuggestionsIdReviewResponseToJson(
  PostApiV1AiSuggestionsIdReviewResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
