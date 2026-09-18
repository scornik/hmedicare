// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'grant_coverage_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GrantCoverageRequest _$GrantCoverageRequestFromJson(
  Map<String, dynamic> json,
) => GrantCoverageRequest(
  coveredDoctorProfileId: json['coveredDoctorProfileId'] as String,
  coveringDoctorProfileId: json['coveringDoctorProfileId'] as String,
  endsAt: DateTime.parse(json['endsAt'] as String),
  reason: json['reason'] as String,
  startsAt: DateTime.parse(json['startsAt'] as String),
);

Map<String, dynamic> _$GrantCoverageRequestToJson(
  GrantCoverageRequest instance,
) => <String, dynamic>{
  'coveredDoctorProfileId': instance.coveredDoctorProfileId,
  'coveringDoctorProfileId': instance.coveringDoctorProfileId,
  'endsAt': instance.endsAt.toIso8601String(),
  'reason': instance.reason,
  'startsAt': instance.startsAt.toIso8601String(),
};
