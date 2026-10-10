// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'delete_api_v1_tenant_sms_credentials_id_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DeleteApiV1TenantSmsCredentialsIdResponse
_$DeleteApiV1TenantSmsCredentialsIdResponseFromJson(
  Map<String, dynamic> json,
) => DeleteApiV1TenantSmsCredentialsIdResponse(
  data: SmsCredentialView.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$DeleteApiV1TenantSmsCredentialsIdResponseToJson(
  DeleteApiV1TenantSmsCredentialsIdResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
