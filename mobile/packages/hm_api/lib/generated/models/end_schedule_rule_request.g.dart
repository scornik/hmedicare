// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'end_schedule_rule_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EndScheduleRuleRequest _$EndScheduleRuleRequestFromJson(
  Map<String, dynamic> json,
) => EndScheduleRuleRequest(
  effectiveTo: json['effectiveTo'] as String,
  expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
);

Map<String, dynamic> _$EndScheduleRuleRequestToJson(
  EndScheduleRuleRequest instance,
) => <String, dynamic>{
  'effectiveTo': instance.effectiveTo,
  'expectedRowVersion': instance.expectedRowVersion,
};
