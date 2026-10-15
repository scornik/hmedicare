// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'ai_credential_usage_list.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AiCredentialUsageList _$AiCredentialUsageListFromJson(
  Map<String, dynamic> json,
) => AiCredentialUsageList(
  items: (json['items'] as List<dynamic>)
      .map((e) => AiCredentialUsage.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$AiCredentialUsageListToJson(
  AiCredentialUsageList instance,
) => <String, dynamic>{'items': instance.items};
