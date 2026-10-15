// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_draft.dart';
import 'response_meta.dart';

part 'post_api_v1_ai_drafts_id_close_response.g.dart';

@JsonSerializable()
class PostApiV1AiDraftsIdCloseResponse {
  const PostApiV1AiDraftsIdCloseResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1AiDraftsIdCloseResponse.fromJson(Map<String, Object?> json) => _$PostApiV1AiDraftsIdCloseResponseFromJson(json);
  
  final AiDraft data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1AiDraftsIdCloseResponseToJson(this);
}
