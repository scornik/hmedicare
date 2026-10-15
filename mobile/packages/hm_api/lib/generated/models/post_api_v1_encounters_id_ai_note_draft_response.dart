// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_job.dart';
import 'response_meta.dart';

part 'post_api_v1_encounters_id_ai_note_draft_response.g.dart';

@JsonSerializable()
class PostApiV1EncountersIdAiNoteDraftResponse {
  const PostApiV1EncountersIdAiNoteDraftResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1EncountersIdAiNoteDraftResponse.fromJson(Map<String, Object?> json) => _$PostApiV1EncountersIdAiNoteDraftResponseFromJson(json);
  
  final AiJob data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1EncountersIdAiNoteDraftResponseToJson(this);
}
