// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_tenant_sms_credentials_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1TenantSmsCredentialsResponse
_$PostApiV1TenantSmsCredentialsResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1TenantSmsCredentialsResponse(
      data: SmsCredentialView.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1TenantSmsCredentialsResponseToJson(
  PostApiV1TenantSmsCredentialsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
