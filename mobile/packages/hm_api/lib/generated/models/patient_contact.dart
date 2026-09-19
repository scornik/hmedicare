// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'patient_contact_relationship.dart';
import 'patient_contact_status.dart';
import 'patient_contact_type.dart';
import 'patient_contact_verification_status.dart';

part 'patient_contact.g.dart';

@JsonSerializable()
class PatientContact {
  const PatientContact({
    required this.displayValue,
    required this.id,
    required this.isPreferred,
    required this.relationship,
    required this.rowVersion,
    required this.status,
    required this.type,
    required this.verificationStatus,
  });
  
  factory PatientContact.fromJson(Map<String, Object?> json) => _$PatientContactFromJson(json);
  
  final String displayValue;
  final String id;
  final bool isPreferred;
  final PatientContactRelationship relationship;
  final int rowVersion;
  final PatientContactStatus status;
  final PatientContactType type;
  final PatientContactVerificationStatus verificationStatus;

  Map<String, Object?> toJson() => _$PatientContactToJson(this);
}
