// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_job.dart';
import 'response_meta.dart';

part 'post_api_v1_ai_jobs_id_cancel_response.g.dart';

@JsonSerializable()
class PostApiV1AiJobsIdCancelResponse {
  const PostApiV1AiJobsIdCancelResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1AiJobsIdCancelResponse.fromJson(Map<String, Object?> json) => _$PostApiV1AiJobsIdCancelResponseFromJson(json);
  
  final AiJob data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1AiJobsIdCancelResponseToJson(this);
}
