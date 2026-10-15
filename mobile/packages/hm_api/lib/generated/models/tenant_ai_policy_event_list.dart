// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'items.dart';

part 'tenant_ai_policy_event_list.g.dart';

@JsonSerializable()
class TenantAiPolicyEventList {
  const TenantAiPolicyEventList({
    required this.items,
  });
  
  factory TenantAiPolicyEventList.fromJson(Map<String, Object?> json) => _$TenantAiPolicyEventListFromJson(json);
  
  final List<Items> items;

  Map<String, Object?> toJson() => _$TenantAiPolicyEventListToJson(this);
}
