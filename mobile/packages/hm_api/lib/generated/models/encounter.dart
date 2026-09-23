// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'encounter_care_mode.dart';
import 'encounter_status.dart';

part 'encounter.g.dart';

@JsonSerializable()
class Encounter {
  const Encounter({
    required this.appointmentId,
    required this.careMode,
    required this.chamberId,
    required this.completedAt,
    required this.coveringDoctorProfileId,
    required this.doctorProfileId,
    required this.id,
    required this.interruptedAt,
    required this.legacyInterim,
    required this.patientId,
    required this.resumedAt,
    required this.rowVersion,
    required this.serialId,
    required this.startedAt,
    required this.status,
  });
  
  factory Encounter.fromJson(Map<String, Object?> json) => _$EncounterFromJson(json);
  
  final String? appointmentId;
  final EncounterCareMode careMode;
  final String chamberId;
  final DateTime? completedAt;

  /// Set when a covering doctor acted, with the grant recorded alongside it
  final String? coveringDoctorProfileId;
  final String doctorProfileId;
  final String id;
  final DateTime? interruptedAt;

  /// Backfilled from a Stage 5 interim transition (ADR-021). Carries no note, because none was written
  final bool legacyInterim;
  final String patientId;
  final DateTime? resumedAt;
  final int rowVersion;
  final String serialId;
  final DateTime startedAt;
  final EncounterStatus status;

  Map<String, Object?> toJson() => _$EncounterToJson(this);
}
