// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'guardianship_authority_scope.dart';
import 'guardianship_relationship.dart';
import 'guardianship_status.dart';
import 'guardianship_verification_method.dart';

part 'guardianship.g.dart';

@JsonSerializable()
class Guardianship {
  const Guardianship({
    required this.authorityScope,
    required this.createdAt,
    required this.dependentPatientId,
    required this.endsOn,
    required this.guardianPatientId,
    required this.guardianUserId,
    required this.id,
    required this.relationship,
    required this.rowVersion,
    required this.startsOn,
    required this.status,
    required this.verificationMethod,
  });
  
  factory Guardianship.fromJson(Map<String, Object?> json) => _$GuardianshipFromJson(json);
  
  final List<GuardianshipAuthorityScope> authorityScope;
  final DateTime createdAt;
  final String dependentPatientId;

  /// Calendar date (no time zone)
  final String? endsOn;
  final String? guardianPatientId;
  final String guardianUserId;
  final String id;
  final GuardianshipRelationship relationship;
  final int rowVersion;

  /// Calendar date (no time zone)
  final String startsOn;
  final GuardianshipStatus status;
  final GuardianshipVerificationMethod? verificationMethod;

  Map<String, Object?> toJson() => _$GuardianshipToJson(this);
}
