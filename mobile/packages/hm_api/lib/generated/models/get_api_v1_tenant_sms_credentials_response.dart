// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'sms_credential_view.dart';
import 'response_meta.dart';

part 'get_api_v1_tenant_sms_credentials_response.g.dart';

@JsonSerializable()
class GetApiV1TenantSmsCredentialsResponse {
  const GetApiV1TenantSmsCredentialsResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1TenantSmsCredentialsResponse.fromJson(Map<String, Object?> json) => _$GetApiV1TenantSmsCredentialsResponseFromJson(json);
  
  final List<SmsCredentialView> data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1TenantSmsCredentialsResponseToJson(this);
}
