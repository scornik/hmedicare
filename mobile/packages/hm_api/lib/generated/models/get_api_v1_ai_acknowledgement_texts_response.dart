// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_acknowledgement_text_list.dart';
import 'response_meta.dart';

part 'get_api_v1_ai_acknowledgement_texts_response.g.dart';

@JsonSerializable()
class GetApiV1AiAcknowledgementTextsResponse {
  const GetApiV1AiAcknowledgementTextsResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1AiAcknowledgementTextsResponse.fromJson(Map<String, Object?> json) => _$GetApiV1AiAcknowledgementTextsResponseFromJson(json);
  
  final AiAcknowledgementTextList data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1AiAcknowledgementTextsResponseToJson(this);
}
