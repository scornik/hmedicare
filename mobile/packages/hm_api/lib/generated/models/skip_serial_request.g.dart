// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'skip_serial_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SkipSerialRequest _$SkipSerialRequestFromJson(Map<String, dynamic> json) =>
    SkipSerialRequest(
      expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
      reason: json['reason'] as String,
    );

Map<String, dynamic> _$SkipSerialRequestToJson(SkipSerialRequest instance) =>
    <String, dynamic>{
      'expectedRowVersion': instance.expectedRowVersion,
      'reason': instance.reason,
    };
