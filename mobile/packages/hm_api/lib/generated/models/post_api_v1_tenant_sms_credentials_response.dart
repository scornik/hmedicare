// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'sms_credential_view.dart';
import 'response_meta.dart';

part 'post_api_v1_tenant_sms_credentials_response.g.dart';

@JsonSerializable()
class PostApiV1TenantSmsCredentialsResponse {
  const PostApiV1TenantSmsCredentialsResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1TenantSmsCredentialsResponse.fromJson(Map<String, Object?> json) => _$PostApiV1TenantSmsCredentialsResponseFromJson(json);
  
  final SmsCredentialView data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1TenantSmsCredentialsResponseToJson(this);
}
