// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'bootstrap_tenant_request_practice_type.dart';
import 'owner.dart';

part 'bootstrap_tenant_request.g.dart';

@JsonSerializable()
class BootstrapTenantRequest {
  const BootstrapTenantRequest({
    required this.name,
    required this.owner,
    required this.practiceType,
    this.slug,
  });
  
  factory BootstrapTenantRequest.fromJson(Map<String, Object?> json) => _$BootstrapTenantRequestFromJson(json);
  
  final String name;
  final Owner owner;
  final BootstrapTenantRequestPracticeType practiceType;
  final String? slug;

  Map<String, Object?> toJson() => _$BootstrapTenantRequestToJson(this);
}
