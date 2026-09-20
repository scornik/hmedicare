// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'queue_policy_patch.dart';

part 'update_chamber_day_policy_request.g.dart';

@JsonSerializable()
class UpdateChamberDayPolicyRequest {
  const UpdateChamberDayPolicyRequest({
    required this.expectedQueueOrderVersion,
    required this.policy,
  });
  
  factory UpdateChamberDayPolicyRequest.fromJson(Map<String, Object?> json) => _$UpdateChamberDayPolicyRequestFromJson(json);
  
  final int expectedQueueOrderVersion;
  final QueuePolicyPatch policy;

  Map<String, Object?> toJson() => _$UpdateChamberDayPolicyRequestToJson(this);
}
