// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'ai_credential_usage.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AiCredentialUsage _$AiCredentialUsageFromJson(Map<String, dynamic> json) =>
    AiCredentialUsage(
      callsRecorded: (json['callsRecorded'] as num).toInt(),
      credentialId: json['credentialId'] as String,
      declaredTier: AiCredentialUsageDeclaredTier.fromJson(
        json['declaredTier'] as String,
      ),
      errorsRecorded: (json['errorsRecorded'] as num).toInt(),
      estimatedRemaining: (json['estimatedRemaining'] as num?)?.toInt(),
      inputTokensToday: (json['inputTokensToday'] as num).toInt(),
      lastRateLimitedAt: json['lastRateLimitedAt'] == null
          ? null
          : DateTime.parse(json['lastRateLimitedAt'] as String),
      outputTokensToday: (json['outputTokensToday'] as num).toInt(),
      providerCode: json['providerCode'] as String,
      requestsThisMinute: (json['requestsThisMinute'] as num).toInt(),
      requestsToday: (json['requestsToday'] as num).toInt(),
      retryAfterUntil: json['retryAfterUntil'] == null
          ? null
          : DateTime.parse(json['retryAfterUntil'] as String),
      status: json['status'] as String,
    );

Map<String, dynamic> _$AiCredentialUsageToJson(AiCredentialUsage instance) =>
    <String, dynamic>{
      'callsRecorded': instance.callsRecorded,
      'credentialId': instance.credentialId,
      'declaredTier': instance.declaredTier,
      'errorsRecorded': instance.errorsRecorded,
      'estimatedRemaining': ?instance.estimatedRemaining,
      'inputTokensToday': instance.inputTokensToday,
      'lastRateLimitedAt': ?instance.lastRateLimitedAt?.toIso8601String(),
      'outputTokensToday': instance.outputTokensToday,
      'providerCode': instance.providerCode,
      'requestsThisMinute': instance.requestsThisMinute,
      'requestsToday': instance.requestsToday,
      'retryAfterUntil': ?instance.retryAfterUntil?.toIso8601String(),
      'status': instance.status,
    };
