// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'create_schedule_rule_request_rule_type.dart';

part 'create_schedule_rule_request.g.dart';

@JsonSerializable()
class CreateScheduleRuleRequest {
  const CreateScheduleRuleRequest({
    required this.effectiveFrom,
    required this.localEndTime,
    required this.localStartTime,
    required this.ruleType,
    this.capacity,
    this.effectiveTo,
    this.exceptionDate,
    this.weekday,
  });
  
  factory CreateScheduleRuleRequest.fromJson(Map<String, Object?> json) => _$CreateScheduleRuleRequestFromJson(json);
  
  final int? capacity;

  /// Calendar date (no time zone)
  final String effectiveFrom;

  /// Calendar date (no time zone)
  final String? effectiveTo;

  /// Calendar date (no time zone)
  final String? exceptionDate;

  /// Clinic-local time of day, HH:MM
  final String localEndTime;

  /// Clinic-local time of day, HH:MM
  final String localStartTime;
  final CreateScheduleRuleRequestRuleType ruleType;
  final int? weekday;

  Map<String, Object?> toJson() => _$CreateScheduleRuleRequestToJson(this);
}
