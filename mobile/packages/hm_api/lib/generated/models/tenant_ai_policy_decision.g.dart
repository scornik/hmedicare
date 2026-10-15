// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'tenant_ai_policy_decision.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

TenantAiPolicyDecision _$TenantAiPolicyDecisionFromJson(
  Map<String, dynamic> json,
) => TenantAiPolicyDecision(
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
  reason: json['reason'] as String,
  expectedRowVersion: (json['expectedRowVersion'] as num?)?.toInt(),
);

Map<String, dynamic> _$TenantAiPolicyDecisionToJson(
  TenantAiPolicyDecision instance,
) => <String, dynamic>{
  'aiEnabled': instance.aiEnabled,
  'allowedProviderCodes': instance.allowedProviderCodes,
  'expectedRowVersion': ?instance.expectedRowVersion,
  'freeTierAiAllowed': instance.freeTierAiAllowed,
  'minAiConsentPolicyVersion': instance.minAiConsentPolicyVersion,
  'minimizationRequiredForNoTraining':
      instance.minimizationRequiredForNoTraining,
  'policyTextVersion': instance.policyTextVersion,
  'rawOutputRetentionDays': instance.rawOutputRetentionDays,
  'reason': instance.reason,
};
