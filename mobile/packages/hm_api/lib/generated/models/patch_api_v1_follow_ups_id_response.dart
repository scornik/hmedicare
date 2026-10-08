// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'follow_up_plan.dart';
import 'response_meta.dart';

part 'patch_api_v1_follow_ups_id_response.g.dart';

@JsonSerializable()
class PatchApiV1FollowUpsIdResponse {
  const PatchApiV1FollowUpsIdResponse({
    required this.data,
    required this.meta,
  });
  
  factory PatchApiV1FollowUpsIdResponse.fromJson(Map<String, Object?> json) => _$PatchApiV1FollowUpsIdResponseFromJson(json);
  
  final FollowUpPlan data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PatchApiV1FollowUpsIdResponseToJson(this);
}
