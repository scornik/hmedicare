// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'after.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

After _$AfterFromJson(Map<String, dynamic> json) => After(
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

Map<String, dynamic> _$AfterToJson(After instance) => <String, dynamic>{
  'aiEnabled': instance.aiEnabled,
  'allowedProviderCodes': instance.allowedProviderCodes,
  'freeTierAiAllowed': instance.freeTierAiAllowed,
  'minAiConsentPolicyVersion': instance.minAiConsentPolicyVersion,
  'minimizationRequiredForNoTraining':
      instance.minimizationRequiredForNoTraining,
  'policyTextVersion': instance.policyTextVersion,
  'rawOutputRetentionDays': instance.rawOutputRetentionDays,
};
