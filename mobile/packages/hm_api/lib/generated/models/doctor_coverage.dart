// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'doctor_coverage_status.dart';

part 'doctor_coverage.g.dart';

@JsonSerializable()
class DoctorCoverage {
  const DoctorCoverage({
    required this.coveredDoctorProfileId,
    required this.coveringDoctorProfileId,
    required this.endsAt,
    required this.id,
    required this.reason,
    required this.rowVersion,
    required this.startsAt,
    required this.status,
  });
  
  factory DoctorCoverage.fromJson(Map<String, Object?> json) => _$DoctorCoverageFromJson(json);
  
  final String coveredDoctorProfileId;
  final String coveringDoctorProfileId;
  final DateTime endsAt;
  final String id;
  final String reason;
  final int rowVersion;
  final DateTime startsAt;
  final DoctorCoverageStatus status;

  Map<String, Object?> toJson() => _$DoctorCoverageToJson(this);
}
