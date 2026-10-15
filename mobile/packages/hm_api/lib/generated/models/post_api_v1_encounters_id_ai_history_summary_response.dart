// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_job.dart';
import 'response_meta.dart';

part 'post_api_v1_encounters_id_ai_history_summary_response.g.dart';

@JsonSerializable()
class PostApiV1EncountersIdAiHistorySummaryResponse {
  const PostApiV1EncountersIdAiHistorySummaryResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1EncountersIdAiHistorySummaryResponse.fromJson(Map<String, Object?> json) => _$PostApiV1EncountersIdAiHistorySummaryResponseFromJson(json);
  
  final AiJob data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1EncountersIdAiHistorySummaryResponseToJson(this);
}
