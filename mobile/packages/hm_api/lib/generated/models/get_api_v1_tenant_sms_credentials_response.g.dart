// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_tenant_sms_credentials_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1TenantSmsCredentialsResponse
_$GetApiV1TenantSmsCredentialsResponseFromJson(Map<String, dynamic> json) =>
    GetApiV1TenantSmsCredentialsResponse(
      data: (json['data'] as List<dynamic>)
          .map((e) => SmsCredentialView.fromJson(e as Map<String, dynamic>))
          .toList(),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$GetApiV1TenantSmsCredentialsResponseToJson(
  GetApiV1TenantSmsCredentialsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
