// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'ai_acknowledgement.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AiAcknowledgement _$AiAcknowledgementFromJson(Map<String, dynamic> json) =>
    AiAcknowledgement(
      acknowledgedAt: DateTime.parse(json['acknowledgedAt'] as String),
      acknowledgedByUserId: json['acknowledgedByUserId'] as String,
      doctorProfileId: json['doctorProfileId'] as String,
      id: json['id'] as String,
      providerCode: json['providerCode'] as String,
      revokeReason: json['revokeReason'] as String?,
      revokedAt: json['revokedAt'] == null
          ? null
          : DateTime.parse(json['revokedAt'] as String),
      rowVersion: (json['rowVersion'] as num).toInt(),
      termsTextSha256: json['termsTextSha256'] as String,
      termsTextVersion: json['termsTextVersion'] as String,
      tier: AiAcknowledgementTier.fromJson(json['tier'] as String),
    );

Map<String, dynamic> _$AiAcknowledgementToJson(AiAcknowledgement instance) =>
    <String, dynamic>{
      'acknowledgedAt': instance.acknowledgedAt.toIso8601String(),
      'acknowledgedByUserId': instance.acknowledgedByUserId,
      'doctorProfileId': instance.doctorProfileId,
      'id': instance.id,
      'providerCode': instance.providerCode,
      'revokeReason': ?instance.revokeReason,
      'revokedAt': ?instance.revokedAt?.toIso8601String(),
      'rowVersion': instance.rowVersion,
      'termsTextSha256': instance.termsTextSha256,
      'termsTextVersion': instance.termsTextVersion,
      'tier': instance.tier,
    };
