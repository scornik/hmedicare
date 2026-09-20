// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'schedule_rule_rule_type.dart';

part 'schedule_rule.g.dart';

@JsonSerializable()
class ScheduleRule {
  const ScheduleRule({
    required this.capacity,
    required this.chamberId,
    required this.createdAt,
    required this.doctorProfileId,
    required this.effectiveFrom,
    required this.effectiveTo,
    required this.exceptionDate,
    required this.id,
    required this.localEndTime,
    required this.localStartTime,
    required this.rowVersion,
    required this.ruleType,
    required this.weekday,
  });
  
  factory ScheduleRule.fromJson(Map<String, Object?> json) => _$ScheduleRuleFromJson(json);
  
  final int? capacity;
  final String chamberId;
  final DateTime createdAt;
  final String doctorProfileId;

  /// Calendar date (no time zone)
  final String effectiveFrom;

  /// Calendar date (no time zone)
  final String? effectiveTo;

  /// Calendar date (no time zone)
  final String? exceptionDate;
  final String id;

  /// Clinic-local time of day, HH:MM
  final String localEndTime;

  /// Clinic-local time of day, HH:MM
  final String localStartTime;
  final int rowVersion;
  final ScheduleRuleRuleType ruleType;
  final int? weekday;

  Map<String, Object?> toJson() => _$ScheduleRuleToJson(this);
}
