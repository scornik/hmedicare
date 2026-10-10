// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'api_v1_tenant_sms_credentials_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ApiV1TenantSmsCredentialsRequestBody
_$ApiV1TenantSmsCredentialsRequestBodyFromJson(Map<String, dynamic> json) =>
    ApiV1TenantSmsCredentialsRequestBody(
      apiKey: json['apiKey'] as String,
      senderId: json['senderId'] as String,
      balanceAlertBdt: json['balanceAlertBdt'] as String?,
    );

Map<String, dynamic> _$ApiV1TenantSmsCredentialsRequestBodyToJson(
  ApiV1TenantSmsCredentialsRequestBody instance,
) => <String, dynamic>{
  'apiKey': instance.apiKey,
  'balanceAlertBdt': ?instance.balanceAlertBdt,
  'senderId': instance.senderId,
};
