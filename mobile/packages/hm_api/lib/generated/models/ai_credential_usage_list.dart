// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_credential_usage.dart';

part 'ai_credential_usage_list.g.dart';

@JsonSerializable()
class AiCredentialUsageList {
  const AiCredentialUsageList({
    required this.items,
  });
  
  factory AiCredentialUsageList.fromJson(Map<String, Object?> json) => _$AiCredentialUsageListFromJson(json);
  
  final List<AiCredentialUsage> items;

  Map<String, Object?> toJson() => _$AiCredentialUsageListToJson(this);
}
