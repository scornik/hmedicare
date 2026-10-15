// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'tenant_ai_policy_event_list.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

TenantAiPolicyEventList _$TenantAiPolicyEventListFromJson(
  Map<String, dynamic> json,
) => TenantAiPolicyEventList(
  items: (json['items'] as List<dynamic>)
      .map((e) => Items.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$TenantAiPolicyEventListToJson(
  TenantAiPolicyEventList instance,
) => <String, dynamic>{'items': instance.items};
