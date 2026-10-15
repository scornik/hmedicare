// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'tenant_ai_policy.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

TenantAiPolicy _$TenantAiPolicyFromJson(Map<String, dynamic> json) =>
    TenantAiPolicy(
      aiEnabled: json['aiEnabled'] as bool,
      allowedProviderCodes: (json['allowedProviderCodes'] as List<dynamic>)
          .map((e) => e as String)
          .toList(),
      decidedAt: json['decidedAt'] == null
          ? null
          : DateTime.parse(json['decidedAt'] as String),
      decidedByUserId: json['decidedByUserId'] as String?,
      freeTierAiAllowed: json['freeTierAiAllowed'] as bool,
      freeTierEffective: json['freeTierEffective'] as bool,
      freeTierForcedOffByProductionGate:
          json['freeTierForcedOffByProductionGate'] as bool,
      minAiConsentPolicyVersion: (json['minAiConsentPolicyVersion'] as num)
          .toInt(),
      minimizationRequiredForNoTraining:
          json['minimizationRequiredForNoTraining'] as bool,
      policyTextVersion: json['policyTextVersion'] as String,
      policyVersion: (json['policyVersion'] as num).toInt(),
      rawOutputRetentionDays: (json['rawOutputRetentionDays'] as num).toInt(),
      rowVersion: (json['rowVersion'] as num).toInt(),
    );

Map<String, dynamic> _$TenantAiPolicyToJson(TenantAiPolicy instance) =>
    <String, dynamic>{
      'aiEnabled': instance.aiEnabled,
      'allowedProviderCodes': instance.allowedProviderCodes,
      'decidedAt': ?instance.decidedAt?.toIso8601String(),
      'decidedByUserId': ?instance.decidedByUserId,
      'freeTierAiAllowed': instance.freeTierAiAllowed,
      'freeTierEffective': instance.freeTierEffective,
      'freeTierForcedOffByProductionGate':
          instance.freeTierForcedOffByProductionGate,
      'minAiConsentPolicyVersion': instance.minAiConsentPolicyVersion,
      'minimizationRequiredForNoTraining':
          instance.minimizationRequiredForNoTraining,
      'policyTextVersion': instance.policyTextVersion,
      'policyVersion': instance.policyVersion,
      'rawOutputRetentionDays': instance.rawOutputRetentionDays,
      'rowVersion': instance.rowVersion,
    };
