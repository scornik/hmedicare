// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_job.dart';
import 'response_meta.dart';

part 'get_api_v1_ai_jobs_id_response.g.dart';

@JsonSerializable()
class GetApiV1AiJobsIdResponse {
  const GetApiV1AiJobsIdResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1AiJobsIdResponse.fromJson(Map<String, Object?> json) => _$GetApiV1AiJobsIdResponseFromJson(json);
  
  final AiJob data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1AiJobsIdResponseToJson(this);
}
