// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'contacts.dart';
import 'create_patient_request_consents.dart';
import 'create_patient_request_preferred_locale.dart';
import 'create_patient_request_sex.dart';
import 'duplicate_review.dart';
import 'patient_address.dart';

part 'create_patient_request.g.dart';

@JsonSerializable()
class CreatePatientRequest {
  const CreatePatientRequest({
    required this.contacts,
    required this.legalName,
    this.consents = const [],
    this.address,
    this.birthYear,
    this.dateOfBirth,
    this.displayName,
    this.duplicateReview,
    this.genderIdentity,
    this.legalNameBn,
    this.preferredLocale,
    this.sex,
  });
  
  factory CreatePatientRequest.fromJson(Map<String, Object?> json) => _$CreatePatientRequestFromJson(json);
  
  final PatientAddress? address;
  final int? birthYear;
  final List<CreatePatientRequestConsents> consents;
  final List<Contacts> contacts;

  /// Calendar date (no time zone)
  final String? dateOfBirth;
  final String? displayName;
  final DuplicateReview? duplicateReview;
  final String? genderIdentity;
  final String legalName;
  final String? legalNameBn;
  final CreatePatientRequestPreferredLocale? preferredLocale;
  final CreatePatientRequestSex? sex;

  Map<String, Object?> toJson() => _$CreatePatientRequestToJson(this);
}
