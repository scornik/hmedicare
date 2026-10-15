// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_draft.dart';
import 'response_meta.dart';

part 'post_api_v1_ai_drafts_id_open_response.g.dart';

@JsonSerializable()
class PostApiV1AiDraftsIdOpenResponse {
  const PostApiV1AiDraftsIdOpenResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1AiDraftsIdOpenResponse.fromJson(Map<String, Object?> json) => _$PostApiV1AiDraftsIdOpenResponseFromJson(json);
  
  final AiDraft data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1AiDraftsIdOpenResponseToJson(this);
}
