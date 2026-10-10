// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_tenant_sms_credentials_id_balance_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1TenantSmsCredentialsIdBalanceResponse
_$GetApiV1TenantSmsCredentialsIdBalanceResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1TenantSmsCredentialsIdBalanceResponse(
  data: json['data'] == null
      ? null
      : SmsBalanceView.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1TenantSmsCredentialsIdBalanceResponseToJson(
  GetApiV1TenantSmsCredentialsIdBalanceResponse instance,
) => <String, dynamic>{'data': ?instance.data, 'meta': instance.meta};
