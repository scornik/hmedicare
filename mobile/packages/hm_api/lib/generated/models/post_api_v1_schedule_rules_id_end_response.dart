// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'schedule_rule.dart';
import 'response_meta.dart';

part 'post_api_v1_schedule_rules_id_end_response.g.dart';

@JsonSerializable()
class PostApiV1ScheduleRulesIdEndResponse {
  const PostApiV1ScheduleRulesIdEndResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1ScheduleRulesIdEndResponse.fromJson(Map<String, Object?> json) => _$PostApiV1ScheduleRulesIdEndResponseFromJson(json);
  
  final ScheduleRule data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1ScheduleRulesIdEndResponseToJson(this);
}
