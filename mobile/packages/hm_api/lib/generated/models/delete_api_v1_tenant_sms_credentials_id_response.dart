// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'sms_credential_view.dart';
import 'response_meta.dart';

part 'delete_api_v1_tenant_sms_credentials_id_response.g.dart';

@JsonSerializable()
class DeleteApiV1TenantSmsCredentialsIdResponse {
  const DeleteApiV1TenantSmsCredentialsIdResponse({
    required this.data,
    required this.meta,
  });
  
  factory DeleteApiV1TenantSmsCredentialsIdResponse.fromJson(Map<String, Object?> json) => _$DeleteApiV1TenantSmsCredentialsIdResponseFromJson(json);
  
  final SmsCredentialView data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$DeleteApiV1TenantSmsCredentialsIdResponseToJson(this);
}
