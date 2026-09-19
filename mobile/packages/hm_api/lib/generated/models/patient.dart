// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'patient_address.dart';
import 'patient_contact.dart';
import 'patient_preferred_locale.dart';
import 'patient_sex.dart';
import 'patient_status.dart';

part 'patient.g.dart';

@JsonSerializable()
class Patient {
  const Patient({
    required this.address,
    required this.birthYear,
    required this.contacts,
    required this.createdAt,
    required this.dateOfBirth,
    required this.displayName,
    required this.genderIdentity,
    required this.id,
    required this.legalName,
    required this.legalNameBn,
    required this.medicalRecordNumber,
    required this.mergedIntoPatientId,
    required this.preferredLocale,
    required this.rowVersion,
    required this.sex,
    required this.status,
    required this.updatedAt,
  });
  
  factory Patient.fromJson(Map<String, Object?> json) => _$PatientFromJson(json);
  
  final PatientAddress? address;
  final int? birthYear;
  final List<PatientContact> contacts;
  final DateTime createdAt;

  /// Calendar date (no time zone)
  final String? dateOfBirth;
  final String displayName;
  final String? genderIdentity;
  final String id;
  final String legalName;
  final String? legalNameBn;
  final String medicalRecordNumber;
  final String? mergedIntoPatientId;
  final PatientPreferredLocale? preferredLocale;
  final int rowVersion;
  final PatientSex? sex;
  final PatientStatus status;
  final DateTime updatedAt;

  Map<String, Object?> toJson() => _$PatientToJson(this);
}
