// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'reschedule_serial_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

RescheduleSerialRequest _$RescheduleSerialRequestFromJson(
  Map<String, dynamic> json,
) => RescheduleSerialRequest(
  expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
  targetChamberDayId: json['targetChamberDayId'] as String,
  reason: json['reason'] as String?,
  targetSlotId: json['targetSlotId'] as String?,
);

Map<String, dynamic> _$RescheduleSerialRequestToJson(
  RescheduleSerialRequest instance,
) => <String, dynamic>{
  'expectedRowVersion': instance.expectedRowVersion,
  'reason': ?instance.reason,
  'targetChamberDayId': instance.targetChamberDayId,
  'targetSlotId': ?instance.targetSlotId,
};
