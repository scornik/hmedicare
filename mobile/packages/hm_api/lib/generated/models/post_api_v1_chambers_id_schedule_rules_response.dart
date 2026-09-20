// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'schedule_rule.dart';
import 'response_meta.dart';

part 'post_api_v1_chambers_id_schedule_rules_response.g.dart';

@JsonSerializable()
class PostApiV1ChambersIdScheduleRulesResponse {
  const PostApiV1ChambersIdScheduleRulesResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1ChambersIdScheduleRulesResponse.fromJson(Map<String, Object?> json) => _$PostApiV1ChambersIdScheduleRulesResponseFromJson(json);
  
  final ScheduleRule data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1ChambersIdScheduleRulesResponseToJson(this);
}
