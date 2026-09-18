// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'doctor_coverage.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DoctorCoverage _$DoctorCoverageFromJson(Map<String, dynamic> json) =>
    DoctorCoverage(
      coveredDoctorProfileId: json['coveredDoctorProfileId'] as String,
      coveringDoctorProfileId: json['coveringDoctorProfileId'] as String,
      endsAt: DateTime.parse(json['endsAt'] as String),
      id: json['id'] as String,
      reason: json['reason'] as String,
      rowVersion: (json['rowVersion'] as num).toInt(),
      startsAt: DateTime.parse(json['startsAt'] as String),
      status: DoctorCoverageStatus.fromJson(json['status'] as String),
    );

Map<String, dynamic> _$DoctorCoverageToJson(DoctorCoverage instance) =>
    <String, dynamic>{
      'coveredDoctorProfileId': instance.coveredDoctorProfileId,
      'coveringDoctorProfileId': instance.coveringDoctorProfileId,
      'endsAt': instance.endsAt.toIso8601String(),
      'id': instance.id,
      'reason': instance.reason,
      'rowVersion': instance.rowVersion,
      'startsAt': instance.startsAt.toIso8601String(),
      'status': instance.status,
    };
