// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'reschedule_serial_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

RescheduleSerialResponse _$RescheduleSerialResponseFromJson(
  Map<String, dynamic> json,
) => RescheduleSerialResponse(
  next: Serial.fromJson(json['next'] as Map<String, dynamic>),
  old: Serial.fromJson(json['old'] as Map<String, dynamic>),
);

Map<String, dynamic> _$RescheduleSerialResponseToJson(
  RescheduleSerialResponse instance,
) => <String, dynamic>{'next': instance.next, 'old': instance.old};
