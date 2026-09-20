// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'schedule_rule.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ScheduleRule _$ScheduleRuleFromJson(Map<String, dynamic> json) => ScheduleRule(
  capacity: (json['capacity'] as num?)?.toInt(),
  chamberId: json['chamberId'] as String,
  createdAt: DateTime.parse(json['createdAt'] as String),
  doctorProfileId: json['doctorProfileId'] as String,
  effectiveFrom: json['effectiveFrom'] as String,
  effectiveTo: json['effectiveTo'] as String?,
  exceptionDate: json['exceptionDate'] as String?,
  id: json['id'] as String,
  localEndTime: json['localEndTime'] as String,
  localStartTime: json['localStartTime'] as String,
  rowVersion: (json['rowVersion'] as num).toInt(),
  ruleType: ScheduleRuleRuleType.fromJson(json['ruleType'] as String),
  weekday: (json['weekday'] as num?)?.toInt(),
);

Map<String, dynamic> _$ScheduleRuleToJson(ScheduleRule instance) =>
    <String, dynamic>{
      'capacity': ?instance.capacity,
      'chamberId': instance.chamberId,
      'createdAt': instance.createdAt.toIso8601String(),
      'doctorProfileId': instance.doctorProfileId,
      'effectiveFrom': instance.effectiveFrom,
      'effectiveTo': ?instance.effectiveTo,
      'exceptionDate': ?instance.exceptionDate,
      'id': instance.id,
      'localEndTime': instance.localEndTime,
      'localStartTime': instance.localStartTime,
      'rowVersion': instance.rowVersion,
      'ruleType': instance.ruleType,
      'weekday': ?instance.weekday,
    };
