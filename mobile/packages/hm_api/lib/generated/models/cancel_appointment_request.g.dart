// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'cancel_appointment_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CancelAppointmentRequest _$CancelAppointmentRequestFromJson(
  Map<String, dynamic> json,
) => CancelAppointmentRequest(
  expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
  reason: CancelAppointmentRequestReason.fromJson(json['reason'] as String),
);

Map<String, dynamic> _$CancelAppointmentRequestToJson(
  CancelAppointmentRequest instance,
) => <String, dynamic>{
  'expectedRowVersion': instance.expectedRowVersion,
  'reason': instance.reason,
};
