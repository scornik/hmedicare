// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_tenant_ai_policy_events_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1TenantAiPolicyEventsResponse
_$GetApiV1TenantAiPolicyEventsResponseFromJson(Map<String, dynamic> json) =>
    GetApiV1TenantAiPolicyEventsResponse(
      data: TenantAiPolicyEventList.fromJson(
        json['data'] as Map<String, dynamic>,
      ),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$GetApiV1TenantAiPolicyEventsResponseToJson(
  GetApiV1TenantAiPolicyEventsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
