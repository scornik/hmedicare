// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'schedule_rule.dart';
import 'response_meta.dart';

part 'get_api_v1_chambers_id_schedule_rules_response.g.dart';

@JsonSerializable()
class GetApiV1ChambersIdScheduleRulesResponse {
  const GetApiV1ChambersIdScheduleRulesResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1ChambersIdScheduleRulesResponse.fromJson(Map<String, Object?> json) => _$GetApiV1ChambersIdScheduleRulesResponseFromJson(json);
  
  final List<ScheduleRule> data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1ChambersIdScheduleRulesResponseToJson(this);
}
