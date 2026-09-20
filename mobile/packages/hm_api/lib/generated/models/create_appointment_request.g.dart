// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'create_appointment_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CreateAppointmentRequest _$CreateAppointmentRequestFromJson(
  Map<String, dynamic> json,
) => CreateAppointmentRequest(
  careMode: CreateAppointmentRequestCareMode.fromJson(
    json['careMode'] as String,
  ),
  chamberId: json['chamberId'] as String,
  localDate: json['localDate'] as String,
  patientId: json['patientId'] as String,
  reason: json['reason'] as String?,
  slotId: json['slotId'] as String?,
  source: json['source'] == null
      ? null
      : CreateAppointmentRequestSource.fromJson(json['source'] as String),
);

Map<String, dynamic> _$CreateAppointmentRequestToJson(
  CreateAppointmentRequest instance,
) => <String, dynamic>{
  'careMode': instance.careMode,
  'chamberId': instance.chamberId,
  'localDate': instance.localDate,
  'patientId': instance.patientId,
  'reason': ?instance.reason,
  'slotId': ?instance.slotId,
  'source': ?instance.source,
};
