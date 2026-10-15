// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'tenant_ai_policy.dart';
import 'response_meta.dart';

part 'get_api_v1_tenant_ai_policy_response.g.dart';

@JsonSerializable()
class GetApiV1TenantAiPolicyResponse {
  const GetApiV1TenantAiPolicyResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1TenantAiPolicyResponse.fromJson(Map<String, Object?> json) => _$GetApiV1TenantAiPolicyResponseFromJson(json);
  
  final TenantAiPolicy data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1TenantAiPolicyResponseToJson(this);
}
