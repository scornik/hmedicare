// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_approval.dart';
import 'response_meta.dart';

part 'post_api_v1_ai_suggestions_id_approve_response.g.dart';

@JsonSerializable()
class PostApiV1AiSuggestionsIdApproveResponse {
  const PostApiV1AiSuggestionsIdApproveResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1AiSuggestionsIdApproveResponse.fromJson(Map<String, Object?> json) => _$PostApiV1AiSuggestionsIdApproveResponseFromJson(json);
  
  final AiApproval data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1AiSuggestionsIdApproveResponseToJson(this);
}
