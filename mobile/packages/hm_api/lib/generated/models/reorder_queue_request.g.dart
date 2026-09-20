// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'reorder_queue_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ReorderQueueRequest _$ReorderQueueRequestFromJson(Map<String, dynamic> json) =>
    ReorderQueueRequest(
      expectedQueueOrderVersion: (json['expectedQueueOrderVersion'] as num)
          .toInt(),
      orderedSerialIds: (json['orderedSerialIds'] as List<dynamic>)
          .map((e) => e as String)
          .toList(),
    );

Map<String, dynamic> _$ReorderQueueRequestToJson(
  ReorderQueueRequest instance,
) => <String, dynamic>{
  'expectedQueueOrderVersion': instance.expectedQueueOrderVersion,
  'orderedSerialIds': instance.orderedSerialIds,
};
