// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'ai_credential.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AiCredential _$AiCredentialFromJson(Map<String, dynamic> json) => AiCredential(
  billingMode: AiCredentialBillingMode.fromJson(json['billingMode'] as String),
  declaredTier: AiCredentialDeclaredTier.fromJson(
    json['declaredTier'] as String,
  ),
  doctorProfileId: json['doctorProfileId'] as String,
  id: json['id'] as String,
  lastErrorClass: json['lastErrorClass'] as String?,
  providerCode: json['providerCode'] as String,
  rowVersion: (json['rowVersion'] as num).toInt(),
  secretLast4: json['secretLast4'] as String?,
  status: AiCredentialStatus.fromJson(json['status'] as String),
  validatedAt: json['validatedAt'] == null
      ? null
      : DateTime.parse(json['validatedAt'] as String),
);

Map<String, dynamic> _$AiCredentialToJson(AiCredential instance) =>
    <String, dynamic>{
      'billingMode': instance.billingMode,
      'declaredTier': instance.declaredTier,
      'doctorProfileId': instance.doctorProfileId,
      'id': instance.id,
      'lastErrorClass': ?instance.lastErrorClass,
      'providerCode': instance.providerCode,
      'rowVersion': instance.rowVersion,
      'secretLast4': ?instance.secretLast4,
      'status': instance.status,
      'validatedAt': ?instance.validatedAt?.toIso8601String(),
    };
