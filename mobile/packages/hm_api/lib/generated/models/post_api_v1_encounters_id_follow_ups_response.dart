// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'follow_up_plan.dart';
import 'response_meta.dart';

part 'post_api_v1_encounters_id_follow_ups_response.g.dart';

@JsonSerializable()
class PostApiV1EncountersIdFollowUpsResponse {
  const PostApiV1EncountersIdFollowUpsResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1EncountersIdFollowUpsResponse.fromJson(Map<String, Object?> json) => _$PostApiV1EncountersIdFollowUpsResponseFromJson(json);
  
  final FollowUpPlan data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1EncountersIdFollowUpsResponseToJson(this);
}
