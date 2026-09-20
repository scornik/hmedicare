// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'cancel_serial_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CancelSerialRequest _$CancelSerialRequestFromJson(Map<String, dynamic> json) =>
    CancelSerialRequest(
      expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
      reason: CancelSerialRequestReason.fromJson(json['reason'] as String),
    );

Map<String, dynamic> _$CancelSerialRequestToJson(
  CancelSerialRequest instance,
) => <String, dynamic>{
  'expectedRowVersion': instance.expectedRowVersion,
  'reason': instance.reason,
};
