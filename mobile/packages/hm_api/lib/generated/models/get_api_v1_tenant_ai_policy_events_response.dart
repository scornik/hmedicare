// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'tenant_ai_policy_event_list.dart';
import 'response_meta.dart';

part 'get_api_v1_tenant_ai_policy_events_response.g.dart';

@JsonSerializable()
class GetApiV1TenantAiPolicyEventsResponse {
  const GetApiV1TenantAiPolicyEventsResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1TenantAiPolicyEventsResponse.fromJson(Map<String, Object?> json) => _$GetApiV1TenantAiPolicyEventsResponseFromJson(json);
  
  final TenantAiPolicyEventList data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1TenantAiPolicyEventsResponseToJson(this);
}
