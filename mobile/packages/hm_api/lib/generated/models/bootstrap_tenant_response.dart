// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'bootstrap_tenant_response.g.dart';

@JsonSerializable()
class BootstrapTenantResponse {
  const BootstrapTenantResponse({
    required this.ownerDoctorProfileId,
    required this.ownerMembershipId,
    required this.ownerUserId,
    required this.slug,
    required this.tenantId,
  });
  
  factory BootstrapTenantResponse.fromJson(Map<String, Object?> json) => _$BootstrapTenantResponseFromJson(json);
  
  final String? ownerDoctorProfileId;
  final String ownerMembershipId;
  final String ownerUserId;
  final String slug;
  final String tenantId;

  Map<String, Object?> toJson() => _$BootstrapTenantResponseToJson(this);
}
