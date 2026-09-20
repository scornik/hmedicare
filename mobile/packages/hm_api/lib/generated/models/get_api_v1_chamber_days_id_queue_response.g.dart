// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_chamber_days_id_queue_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1ChamberDaysIdQueueResponse _$GetApiV1ChamberDaysIdQueueResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1ChamberDaysIdQueueResponse(
  data: QueueSnapshot.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1ChamberDaysIdQueueResponseToJson(
  GetApiV1ChamberDaysIdQueueResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
