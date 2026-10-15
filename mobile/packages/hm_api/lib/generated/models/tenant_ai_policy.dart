// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'tenant_ai_policy.g.dart';

@JsonSerializable()
class TenantAiPolicy {
  const TenantAiPolicy({
    required this.aiEnabled,
    required this.allowedProviderCodes,
    required this.decidedAt,
    required this.decidedByUserId,
    required this.freeTierAiAllowed,
    required this.freeTierEffective,
    required this.freeTierForcedOffByProductionGate,
    required this.minAiConsentPolicyVersion,
    required this.minimizationRequiredForNoTraining,
    required this.policyTextVersion,
    required this.policyVersion,
    required this.rawOutputRetentionDays,
    required this.rowVersion,
  });
  
  factory TenantAiPolicy.fromJson(Map<String, Object?> json) => _$TenantAiPolicyFromJson(json);
  
  final bool aiEnabled;
  final List<String> allowedProviderCodes;
  final DateTime? decidedAt;
  final String? decidedByUserId;
  final bool freeTierAiAllowed;

  /// What the policy engine applies; false while the production research gate is open
  final bool freeTierEffective;

  /// True when the stored choice is being overridden, so a screen can explain itself
  final bool freeTierForcedOffByProductionGate;
  final int minAiConsentPolicyVersion;
  final bool minimizationRequiredForNoTraining;
  final String policyTextVersion;
  final int policyVersion;
  final int rawOutputRetentionDays;
  final int rowVersion;

  Map<String, Object?> toJson() => _$TenantAiPolicyToJson(this);
}
