// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'api_v1_tenant_sms_credentials_request_body.g.dart';

@JsonSerializable()
class ApiV1TenantSmsCredentialsRequestBody {
  const ApiV1TenantSmsCredentialsRequestBody({
    required this.apiKey,
    required this.senderId,
    this.balanceAlertBdt,
  });
  
  factory ApiV1TenantSmsCredentialsRequestBody.fromJson(Map<String, Object?> json) => _$ApiV1TenantSmsCredentialsRequestBodyFromJson(json);
  
  final String apiKey;
  final String? balanceAlertBdt;
  final String senderId;

  Map<String, Object?> toJson() => _$ApiV1TenantSmsCredentialsRequestBodyToJson(this);
}
