// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'create_schedule_rule_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CreateScheduleRuleRequest _$CreateScheduleRuleRequestFromJson(
  Map<String, dynamic> json,
) => CreateScheduleRuleRequest(
  effectiveFrom: json['effectiveFrom'] as String,
  localEndTime: json['localEndTime'] as String,
  localStartTime: json['localStartTime'] as String,
  ruleType: CreateScheduleRuleRequestRuleType.fromJson(
    json['ruleType'] as String,
  ),
  capacity: (json['capacity'] as num?)?.toInt(),
  effectiveTo: json['effectiveTo'] as String?,
  exceptionDate: json['exceptionDate'] as String?,
  weekday: (json['weekday'] as num?)?.toInt(),
);

Map<String, dynamic> _$CreateScheduleRuleRequestToJson(
  CreateScheduleRuleRequest instance,
) => <String, dynamic>{
  'capacity': ?instance.capacity,
  'effectiveFrom': instance.effectiveFrom,
  'effectiveTo': ?instance.effectiveTo,
  'exceptionDate': ?instance.exceptionDate,
  'localEndTime': instance.localEndTime,
  'localStartTime': instance.localStartTime,
  'ruleType': instance.ruleType,
  'weekday': ?instance.weekday,
};
