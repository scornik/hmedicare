// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_job_list.dart';
import 'response_meta.dart';

part 'get_api_v1_encounters_id_ai_jobs_response.g.dart';

@JsonSerializable()
class GetApiV1EncountersIdAiJobsResponse {
  const GetApiV1EncountersIdAiJobsResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1EncountersIdAiJobsResponse.fromJson(Map<String, Object?> json) => _$GetApiV1EncountersIdAiJobsResponseFromJson(json);
  
  final AiJobList data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1EncountersIdAiJobsResponseToJson(this);
}
