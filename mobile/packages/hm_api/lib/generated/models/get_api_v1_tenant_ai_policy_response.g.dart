// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_tenant_ai_policy_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1TenantAiPolicyResponse _$GetApiV1TenantAiPolicyResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1TenantAiPolicyResponse(
  data: TenantAiPolicy.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1TenantAiPolicyResponseToJson(
  GetApiV1TenantAiPolicyResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
