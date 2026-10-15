// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_acknowledgement.dart';
import 'response_meta.dart';

part 'post_api_v1_ai_acknowledgements_response.g.dart';

@JsonSerializable()
class PostApiV1AiAcknowledgementsResponse {
  const PostApiV1AiAcknowledgementsResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1AiAcknowledgementsResponse.fromJson(Map<String, Object?> json) => _$PostApiV1AiAcknowledgementsResponseFromJson(json);
  
  final AiAcknowledgement data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1AiAcknowledgementsResponseToJson(this);
}
