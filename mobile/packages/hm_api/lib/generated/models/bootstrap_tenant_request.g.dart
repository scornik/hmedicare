// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'bootstrap_tenant_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

BootstrapTenantRequest _$BootstrapTenantRequestFromJson(
  Map<String, dynamic> json,
) => BootstrapTenantRequest(
  name: json['name'] as String,
  owner: Owner.fromJson(json['owner'] as Map<String, dynamic>),
  practiceType: BootstrapTenantRequestPracticeType.fromJson(
    json['practiceType'] as String,
  ),
  slug: json['slug'] as String?,
);

Map<String, dynamic> _$BootstrapTenantRequestToJson(
  BootstrapTenantRequest instance,
) => <String, dynamic>{
  'name': instance.name,
  'owner': instance.owner,
  'practiceType': instance.practiceType,
  'slug': instance.slug,
};
