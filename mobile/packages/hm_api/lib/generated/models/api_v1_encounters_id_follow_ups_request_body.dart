// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'api_v1_encounters_id_follow_ups_request_body.g.dart';

@JsonSerializable()
class ApiV1EncountersIdFollowUpsRequestBody {
  const ApiV1EncountersIdFollowUpsRequestBody({
    required this.dueStartDate,
    required this.reason,
    this.dueEndDate,
    this.instructions,
  });
  
  factory ApiV1EncountersIdFollowUpsRequestBody.fromJson(Map<String, Object?> json) => _$ApiV1EncountersIdFollowUpsRequestBodyFromJson(json);
  
  final String? dueEndDate;
  final String dueStartDate;
  final String? instructions;
  final String reason;

  Map<String, Object?> toJson() => _$ApiV1EncountersIdFollowUpsRequestBodyToJson(this);
}
