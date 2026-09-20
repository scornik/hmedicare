// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'put_api_v1_chamber_days_id_queue_policy_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PutApiV1ChamberDaysIdQueuePolicyResponse
_$PutApiV1ChamberDaysIdQueuePolicyResponseFromJson(Map<String, dynamic> json) =>
    PutApiV1ChamberDaysIdQueuePolicyResponse(
      data: ChamberDay.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PutApiV1ChamberDaysIdQueuePolicyResponseToJson(
  PutApiV1ChamberDaysIdQueuePolicyResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
