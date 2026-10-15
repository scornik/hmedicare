// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_credential_usage_declared_tier.dart';

part 'ai_credential_usage.g.dart';

@JsonSerializable()
class AiCredentialUsage {
  const AiCredentialUsage({
    required this.callsRecorded,
    required this.credentialId,
    required this.declaredTier,
    required this.errorsRecorded,
    required this.estimatedRemaining,
    required this.inputTokensToday,
    required this.lastRateLimitedAt,
    required this.outputTokensToday,
    required this.providerCode,
    required this.requestsThisMinute,
    required this.requestsToday,
    required this.retryAfterUntil,
    required this.status,
  });
  
  factory AiCredentialUsage.fromJson(Map<String, Object?> json) => _$AiCredentialUsageFromJson(json);
  
  final int callsRecorded;
  final String credentialId;
  final AiCredentialUsageDeclaredTier declaredTier;
  final int errorsRecorded;

  /// Always an estimate, and null unless a quota hint was configured
  final int? estimatedRemaining;

  /// Provider-reported where available, zero where not. An observation, not a bill
  final int inputTokensToday;
  final DateTime? lastRateLimitedAt;
  final int outputTokensToday;
  final String providerCode;
  final int requestsThisMinute;
  final int requestsToday;

  /// Set while the provider is still refusing; the runner throttles itself until then
  final DateTime? retryAfterUntil;
  final String status;

  Map<String, Object?> toJson() => _$AiCredentialUsageToJson(this);
}
