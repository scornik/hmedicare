// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'chamber_day.dart';
import 'response_meta.dart';

part 'put_api_v1_chamber_days_id_queue_policy_response.g.dart';

@JsonSerializable()
class PutApiV1ChamberDaysIdQueuePolicyResponse {
  const PutApiV1ChamberDaysIdQueuePolicyResponse({
    required this.data,
    required this.meta,
  });
  
  factory PutApiV1ChamberDaysIdQueuePolicyResponse.fromJson(Map<String, Object?> json) => _$PutApiV1ChamberDaysIdQueuePolicyResponseFromJson(json);
  
  final ChamberDay data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PutApiV1ChamberDaysIdQueuePolicyResponseToJson(this);
}
