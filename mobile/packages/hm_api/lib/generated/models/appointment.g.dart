// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'appointment.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Appointment _$AppointmentFromJson(Map<String, dynamic> json) => Appointment(
  bookedByUserId: json['bookedByUserId'] as String,
  bookedOnBehalf: json['bookedOnBehalf'] == null
      ? null
      : AppointmentBookedOnBehalf.fromJson(json['bookedOnBehalf'] as String),
  cancelReason: json['cancelReason'] as String?,
  careMode: AppointmentCareMode.fromJson(json['careMode'] as String),
  chamberDayId: json['chamberDayId'] as String,
  chamberId: json['chamberId'] as String,
  createdAt: DateTime.parse(json['createdAt'] as String),
  doctorProfileId: json['doctorProfileId'] as String,
  id: json['id'] as String,
  localDate: json['localDate'] as String,
  patientId: json['patientId'] as String,
  paymentRequirement: AppointmentPaymentRequirement.fromJson(
    json['paymentRequirement'] as String,
  ),
  paymentStatus: AppointmentPaymentStatus.fromJson(
    json['paymentStatus'] as String,
  ),
  reason: json['reason'] as String?,
  rescheduledFromAppointmentId: json['rescheduledFromAppointmentId'] as String?,
  rowVersion: (json['rowVersion'] as num).toInt(),
  serial: json['serial'] == null
      ? null
      : Serial.fromJson(json['serial'] as Map<String, dynamic>),
  slotId: json['slotId'] as String?,
  slotLabel: json['slotLabel'] as String?,
  source: AppointmentSource.fromJson(json['source'] as String),
  status: AppointmentStatus.fromJson(json['status'] as String),
  updatedAt: DateTime.parse(json['updatedAt'] as String),
);

Map<String, dynamic> _$AppointmentToJson(Appointment instance) =>
    <String, dynamic>{
      'bookedByUserId': instance.bookedByUserId,
      'bookedOnBehalf': ?instance.bookedOnBehalf,
      'cancelReason': ?instance.cancelReason,
      'careMode': instance.careMode,
      'chamberDayId': instance.chamberDayId,
      'chamberId': instance.chamberId,
      'createdAt': instance.createdAt.toIso8601String(),
      'doctorProfileId': instance.doctorProfileId,
      'id': instance.id,
      'localDate': instance.localDate,
      'patientId': instance.patientId,
      'paymentRequirement': instance.paymentRequirement,
      'paymentStatus': instance.paymentStatus,
      'reason': ?instance.reason,
      'rescheduledFromAppointmentId': ?instance.rescheduledFromAppointmentId,
      'rowVersion': instance.rowVersion,
      'serial': ?instance.serial,
      'slotId': ?instance.slotId,
      'slotLabel': ?instance.slotLabel,
      'source': instance.source,
      'status': instance.status,
      'updatedAt': instance.updatedAt.toIso8601String(),
    };
