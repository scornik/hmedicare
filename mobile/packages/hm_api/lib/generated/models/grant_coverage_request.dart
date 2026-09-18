// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'grant_coverage_request.g.dart';

@JsonSerializable()
class GrantCoverageRequest {
  const GrantCoverageRequest({
    required this.coveredDoctorProfileId,
    required this.coveringDoctorProfileId,
    required this.endsAt,
    required this.reason,
    required this.startsAt,
  });
  
  factory GrantCoverageRequest.fromJson(Map<String, Object?> json) => _$GrantCoverageRequestFromJson(json);
  
  final String coveredDoctorProfileId;
  final String coveringDoctorProfileId;
  final DateTime endsAt;
  final String reason;
  final DateTime startsAt;

  Map<String, Object?> toJson() => _$GrantCoverageRequestToJson(this);
}
