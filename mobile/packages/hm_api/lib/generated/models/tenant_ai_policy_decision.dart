// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'tenant_ai_policy_decision.g.dart';

@JsonSerializable()
class TenantAiPolicyDecision {
  const TenantAiPolicyDecision({
    required this.aiEnabled,
    required this.allowedProviderCodes,
    required this.freeTierAiAllowed,
    required this.minAiConsentPolicyVersion,
    required this.minimizationRequiredForNoTraining,
    required this.policyTextVersion,
    required this.rawOutputRetentionDays,
    required this.reason,
    this.expectedRowVersion,
  });
  
  factory TenantAiPolicyDecision.fromJson(Map<String, Object?> json) => _$TenantAiPolicyDecisionFromJson(json);
  
  final bool aiEnabled;
  final List<String> allowedProviderCodes;
  final int? expectedRowVersion;
  final bool freeTierAiAllowed;
  final int minAiConsentPolicyVersion;
  final bool minimizationRequiredForNoTraining;
  final String policyTextVersion;
  final int rawOutputRetentionDays;

  /// Why, in the owner’s words. Recorded in the policy event and never defaulted
  final String reason;

  Map<String, Object?> toJson() => _$TenantAiPolicyDecisionToJson(this);
}
