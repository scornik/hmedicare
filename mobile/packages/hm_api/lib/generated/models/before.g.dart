// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'before.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Before _$BeforeFromJson(Map<String, dynamic> json) => Before(
  aiEnabled: json['aiEnabled'] as bool,
  allowedProviderCodes: (json['allowedProviderCodes'] as List<dynamic>)
      .map((e) => e as String)
      .toList(),
  freeTierAiAllowed: json['freeTierAiAllowed'] as bool,
  minAiConsentPolicyVersion: (json['minAiConsentPolicyVersion'] as num).toInt(),
  minimizationRequiredForNoTraining:
      json['minimizationRequiredForNoTraining'] as bool,
  policyTextVersion: json['policyTextVersion'] as String,
  rawOutputRetentionDays: (json['rawOutputRetentionDays'] as num).toInt(),
);

Map<String, dynamic> _$BeforeToJson(Before instance) => <String, dynamic>{
  'aiEnabled': instance.aiEnabled,
  'allowedProviderCodes': instance.allowedProviderCodes,
  'freeTierAiAllowed': instance.freeTierAiAllowed,
  'minAiConsentPolicyVersion': instance.minAiConsentPolicyVersion,
  'minimizationRequiredForNoTraining':
      instance.minimizationRequiredForNoTraining,
  'policyTextVersion': instance.policyTextVersion,
  'rawOutputRetentionDays': instance.rawOutputRetentionDays,
};
