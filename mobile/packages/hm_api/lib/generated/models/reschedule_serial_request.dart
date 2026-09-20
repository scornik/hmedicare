// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'reschedule_serial_request.g.dart';

@JsonSerializable()
class RescheduleSerialRequest {
  const RescheduleSerialRequest({
    required this.expectedRowVersion,
    required this.targetChamberDayId,
    this.reason,
    this.targetSlotId,
  });
  
  factory RescheduleSerialRequest.fromJson(Map<String, Object?> json) => _$RescheduleSerialRequestFromJson(json);
  
  final int expectedRowVersion;
  final String? reason;
  final String targetChamberDayId;
  final String? targetSlotId;

  Map<String, Object?> toJson() => _$RescheduleSerialRequestToJson(this);
}
