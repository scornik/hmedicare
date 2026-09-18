// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'bootstrap_tenant_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

BootstrapTenantResponse _$BootstrapTenantResponseFromJson(
  Map<String, dynamic> json,
) => BootstrapTenantResponse(
  ownerDoctorProfileId: json['ownerDoctorProfileId'] as String?,
  ownerMembershipId: json['ownerMembershipId'] as String,
  ownerUserId: json['ownerUserId'] as String,
  slug: json['slug'] as String,
  tenantId: json['tenantId'] as String,
);

Map<String, dynamic> _$BootstrapTenantResponseToJson(
  BootstrapTenantResponse instance,
) => <String, dynamic>{
  'ownerDoctorProfileId': instance.ownerDoctorProfileId,
  'ownerMembershipId': instance.ownerMembershipId,
  'ownerUserId': instance.ownerUserId,
  'slug': instance.slug,
  'tenantId': instance.tenantId,
};
