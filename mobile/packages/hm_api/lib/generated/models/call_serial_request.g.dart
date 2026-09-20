// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'call_serial_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CallSerialRequest _$CallSerialRequestFromJson(Map<String, dynamic> json) =>
    CallSerialRequest(
      expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
      overrideReason: json['overrideReason'] as String?,
    );

Map<String, dynamic> _$CallSerialRequestToJson(CallSerialRequest instance) =>
    <String, dynamic>{
      'expectedRowVersion': instance.expectedRowVersion,
      'overrideReason': ?instance.overrideReason,
    };
