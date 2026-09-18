// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'data.dart';
import 'response_meta.dart';

part 'get_api_v1_me_tenant_context_response.g.dart';

@JsonSerializable()
class GetApiV1MeTenantContextResponse {
  const GetApiV1MeTenantContextResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1MeTenantContextResponse.fromJson(Map<String, Object?> json) => _$GetApiV1MeTenantContextResponseFromJson(json);
  
  final Data data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1MeTenantContextResponseToJson(this);
}
