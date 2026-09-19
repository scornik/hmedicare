// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'add_contacts.dart';
import 'patient_address.dart';
import 'update_patient_request_preferred_locale.dart';
import 'update_patient_request_sex.dart';

part 'update_patient_request.g.dart';

@JsonSerializable()
class UpdatePatientRequest {
  const UpdatePatientRequest({
    required this.expectedRowVersion,
    this.addContacts,
    this.address,
    this.birthYear,
    this.dateOfBirth,
    this.displayName,
    this.genderIdentity,
    this.legalName,
    this.legalNameBn,
    this.preferredLocale,
    this.removeContactIds,
    this.sex,
  });
  
  factory UpdatePatientRequest.fromJson(Map<String, Object?> json) => _$UpdatePatientRequestFromJson(json);
  
  final List<AddContacts>? addContacts;
  final PatientAddress? address;
  final int? birthYear;

  /// Calendar date (no time zone)
  final String? dateOfBirth;
  final String? displayName;
  final int expectedRowVersion;
  final String? genderIdentity;
  final String? legalName;
  final String? legalNameBn;
  final UpdatePatientRequestPreferredLocale? preferredLocale;
  final List<String>? removeContactIds;
  final UpdatePatientRequestSex? sex;

  Map<String, Object?> toJson() => _$UpdatePatientRequestToJson(this);
}
