// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'bootstrap_tenant_response.dart';
import 'response_meta.dart';

part 'post_api_v1_tenants_response.g.dart';

@JsonSerializable()
class PostApiV1TenantsResponse {
  const PostApiV1TenantsResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1TenantsResponse.fromJson(Map<String, Object?> json) => _$PostApiV1TenantsResponseFromJson(json);
  
  final BootstrapTenantResponse data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1TenantsResponseToJson(this);
}
