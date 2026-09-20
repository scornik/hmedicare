// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'end_schedule_rule_request.g.dart';

@JsonSerializable()
class EndScheduleRuleRequest {
  const EndScheduleRuleRequest({
    required this.effectiveTo,
    required this.expectedRowVersion,
  });
  
  factory EndScheduleRuleRequest.fromJson(Map<String, Object?> json) => _$EndScheduleRuleRequestFromJson(json);
  
  /// Calendar date (no time zone)
  final String effectiveTo;
  final int expectedRowVersion;

  Map<String, Object?> toJson() => _$EndScheduleRuleRequestToJson(this);
}
