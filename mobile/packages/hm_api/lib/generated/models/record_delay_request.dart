// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'record_delay_request_reason_code.dart';

part 'record_delay_request.g.dart';

@JsonSerializable()
class RecordDelayRequest {
  const RecordDelayRequest({
    required this.delayMinutes,
    required this.expectedQueueOrderVersion,
    required this.reasonCode,
  });
  
  factory RecordDelayRequest.fromJson(Map<String, Object?> json) => _$RecordDelayRequestFromJson(json);
  
  final int delayMinutes;
  final int expectedQueueOrderVersion;
  final RecordDelayRequestReasonCode reasonCode;

  Map<String, Object?> toJson() => _$RecordDelayRequestToJson(this);
}
