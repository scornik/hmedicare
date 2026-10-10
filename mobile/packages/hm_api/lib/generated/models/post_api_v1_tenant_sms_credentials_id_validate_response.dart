// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'data4.dart';
import 'response_meta.dart';

part 'post_api_v1_tenant_sms_credentials_id_validate_response.g.dart';

@JsonSerializable()
class PostApiV1TenantSmsCredentialsIdValidateResponse {
  const PostApiV1TenantSmsCredentialsIdValidateResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1TenantSmsCredentialsIdValidateResponse.fromJson(Map<String, Object?> json) => _$PostApiV1TenantSmsCredentialsIdValidateResponseFromJson(json);
  
  final Data4 data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1TenantSmsCredentialsIdValidateResponseToJson(this);
}
