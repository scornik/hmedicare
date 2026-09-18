// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_me_tenant_context_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1MeTenantContextResponse _$GetApiV1MeTenantContextResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1MeTenantContextResponse(
  data: Data.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1MeTenantContextResponseToJson(
  GetApiV1MeTenantContextResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
