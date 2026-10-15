// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'create_ai_credential_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CreateAiCredentialRequest _$CreateAiCredentialRequestFromJson(
  Map<String, dynamic> json,
) => CreateAiCredentialRequest(
  billingMode: CreateAiCredentialRequestBillingMode.fromJson(
    json['billingMode'] as String,
  ),
  declaredTier: CreateAiCredentialRequestDeclaredTier.fromJson(
    json['declaredTier'] as String,
  ),
  providerCode: json['providerCode'] as String,
  secret: json['secret'] as String,
  dataUseAckId: json['dataUseAckId'] as String?,
);

Map<String, dynamic> _$CreateAiCredentialRequestToJson(
  CreateAiCredentialRequest instance,
) => <String, dynamic>{
  'billingMode': instance.billingMode,
  'dataUseAckId': ?instance.dataUseAckId,
  'declaredTier': instance.declaredTier,
  'providerCode': instance.providerCode,
  'secret': instance.secret,
};
