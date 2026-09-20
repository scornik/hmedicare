// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'patient_serial_view_care_mode.dart';
import 'patient_serial_view_day_status.dart';
import 'patient_serial_view_status.dart';

part 'patient_serial_view.g.dart';

@JsonSerializable()
class PatientSerialView {
  const PatientSerialView({
    required this.asOf,
    required this.careMode,
    required this.chamberDayId,
    required this.dayStatus,
    required this.estimatedPosition,
    required this.estimatedWaitMinutes,
    required this.expectedDelayMinutes,
    required this.localDate,
    required this.peopleAhead,
    required this.recallDeadlineAt,
    required this.recallsRemaining,
    required this.rowVersion,
    required this.serialId,
    required this.serialNumber,
    required this.status,
  });
  
  factory PatientSerialView.fromJson(Map<String, Object?> json) => _$PatientSerialViewFromJson(json);
  
  final DateTime asOf;
  final PatientSerialViewCareMode careMode;
  final String chamberDayId;
  final PatientSerialViewDayStatus dayStatus;

  /// Estimate before arrival; not a queue position
  final int? estimatedPosition;
  final int? estimatedWaitMinutes;
  final int? expectedDelayMinutes;

  /// Calendar date (no time zone)
  final String localDate;

  /// Live count ahead in the queue, once the patient has arrived
  final int? peopleAhead;
  final DateTime? recallDeadlineAt;
  final int? recallsRemaining;

  /// Send this back with a command on this serial (confirm, check-in, cancel, remote-ready)
  final int rowVersion;
  final String serialId;
  final int serialNumber;
  final PatientSerialViewStatus status;

  Map<String, Object?> toJson() => _$PatientSerialViewToJson(this);
}
