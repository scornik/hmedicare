// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'put_api_v1_tenant_ai_policy_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PutApiV1TenantAiPolicyResponse _$PutApiV1TenantAiPolicyResponseFromJson(
  Map<String, dynamic> json,
) => PutApiV1TenantAiPolicyResponse(
  data: TenantAiPolicy.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PutApiV1TenantAiPolicyResponseToJson(
  PutApiV1TenantAiPolicyResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
