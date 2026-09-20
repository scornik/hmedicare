// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'queue_snapshot.dart';
import 'response_meta.dart';

part 'get_api_v1_chamber_days_id_queue_response.g.dart';

@JsonSerializable()
class GetApiV1ChamberDaysIdQueueResponse {
  const GetApiV1ChamberDaysIdQueueResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1ChamberDaysIdQueueResponse.fromJson(Map<String, Object?> json) => _$GetApiV1ChamberDaysIdQueueResponseFromJson(json);
  
  final QueueSnapshot data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1ChamberDaysIdQueueResponseToJson(this);
}
