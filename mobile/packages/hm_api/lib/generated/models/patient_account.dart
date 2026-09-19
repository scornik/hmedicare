// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'patient_account_relationship.dart';
import 'patient_account_status.dart';
import 'patient_account_verification_method.dart';

part 'patient_account.g.dart';

@JsonSerializable()
class PatientAccount {
  const PatientAccount({
    required this.createdAt,
    required this.id,
    required this.patientId,
    required this.relationship,
    required this.rowVersion,
    required this.status,
    required this.userId,
    required this.verificationMethod,
    required this.verifiedAt,
  });
  
  factory PatientAccount.fromJson(Map<String, Object?> json) => _$PatientAccountFromJson(json);
  
  final DateTime createdAt;
  final String id;
  final String patientId;
  final PatientAccountRelationship relationship;
  final int rowVersion;
  final PatientAccountStatus status;
  final String userId;
  final PatientAccountVerificationMethod verificationMethod;
  final DateTime? verifiedAt;

  Map<String, Object?> toJson() => _$PatientAccountToJson(this);
}
