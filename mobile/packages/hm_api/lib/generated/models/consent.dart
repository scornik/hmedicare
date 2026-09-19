// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'consent_given_by_relationship.dart';
import 'consent_purpose.dart';
import 'consent_status.dart';

part 'consent.g.dart';

@JsonSerializable()
class Consent {
  const Consent({
    required this.capturedAt,
    required this.givenByRelationship,
    required this.id,
    required this.patientId,
    required this.policyVersion,
    required this.purpose,
    required this.rowVersion,
    required this.status,
    required this.withdrawnAt,
  });
  
  factory Consent.fromJson(Map<String, Object?> json) => _$ConsentFromJson(json);
  
  final DateTime capturedAt;
  final ConsentGivenByRelationship givenByRelationship;
  final String id;
  final String patientId;
  final int policyVersion;
  final ConsentPurpose purpose;
  final int rowVersion;
  final ConsentStatus status;
  final DateTime? withdrawnAt;

  Map<String, Object?> toJson() => _$ConsentToJson(this);
}
