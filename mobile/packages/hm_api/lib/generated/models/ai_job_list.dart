// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_job.dart';

part 'ai_job_list.g.dart';

@JsonSerializable()
class AiJobList {
  const AiJobList({
    required this.items,
  });
  
  factory AiJobList.fromJson(Map<String, Object?> json) => _$AiJobListFromJson(json);
  
  final List<AiJob> items;

  Map<String, Object?> toJson() => _$AiJobListToJson(this);
}
