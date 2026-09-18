// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_tenants_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1TenantsResponse _$PostApiV1TenantsResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1TenantsResponse(
  data: BootstrapTenantResponse.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1TenantsResponseToJson(
  PostApiV1TenantsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
