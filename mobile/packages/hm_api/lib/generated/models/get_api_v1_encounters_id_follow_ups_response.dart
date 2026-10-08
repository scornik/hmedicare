// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'follow_up_plan.dart';
import 'response_meta.dart';

part 'get_api_v1_encounters_id_follow_ups_response.g.dart';

@JsonSerializable()
class GetApiV1EncountersIdFollowUpsResponse {
  const GetApiV1EncountersIdFollowUpsResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1EncountersIdFollowUpsResponse.fromJson(Map<String, Object?> json) => _$GetApiV1EncountersIdFollowUpsResponseFromJson(json);
  
  final List<FollowUpPlan> data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1EncountersIdFollowUpsResponseToJson(this);
}
