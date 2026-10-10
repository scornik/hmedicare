// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'api_v1_tenant_sms_credentials_id_validate_request_body.g.dart';

@JsonSerializable()
class ApiV1TenantSmsCredentialsIdValidateRequestBody {
  const ApiV1TenantSmsCredentialsIdValidateRequestBody({
    required this.rowVersion,
  });
  
  factory ApiV1TenantSmsCredentialsIdValidateRequestBody.fromJson(Map<String, Object?> json) => _$ApiV1TenantSmsCredentialsIdValidateRequestBodyFromJson(json);
  
  final int rowVersion;

  Map<String, Object?> toJson() => _$ApiV1TenantSmsCredentialsIdValidateRequestBodyToJson(this);
}
