// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'appointment_booked_on_behalf.dart';
import 'appointment_care_mode.dart';
import 'appointment_payment_requirement.dart';
import 'appointment_payment_status.dart';
import 'appointment_source.dart';
import 'appointment_status.dart';
import 'serial.dart';

part 'appointment.g.dart';

@JsonSerializable()
class Appointment {
  const Appointment({
    required this.bookedByUserId,
    required this.bookedOnBehalf,
    required this.cancelReason,
    required this.careMode,
    required this.chamberDayId,
    required this.chamberId,
    required this.createdAt,
    required this.doctorProfileId,
    required this.id,
    required this.localDate,
    required this.patientId,
    required this.paymentRequirement,
    required this.paymentStatus,
    required this.reason,
    required this.rescheduledFromAppointmentId,
    required this.rowVersion,
    required this.serial,
    required this.slotId,
    required this.slotLabel,
    required this.source,
    required this.status,
    required this.updatedAt,
  });
  
  factory Appointment.fromJson(Map<String, Object?> json) => _$AppointmentFromJson(json);
  
  final String bookedByUserId;
  final AppointmentBookedOnBehalf? bookedOnBehalf;
  final String? cancelReason;
  final AppointmentCareMode careMode;
  final String chamberDayId;
  final String chamberId;
  final DateTime createdAt;
  final String doctorProfileId;
  final String id;

  /// Calendar date (no time zone)
  final String localDate;
  final String patientId;
  final AppointmentPaymentRequirement paymentRequirement;
  final AppointmentPaymentStatus paymentStatus;
  final String? reason;
  final String? rescheduledFromAppointmentId;
  final int rowVersion;
  final Serial? serial;
  final String? slotId;
  final String? slotLabel;
  final AppointmentSource source;
  final AppointmentStatus status;
  final DateTime updatedAt;

  Map<String, Object?> toJson() => _$AppointmentToJson(this);
}
