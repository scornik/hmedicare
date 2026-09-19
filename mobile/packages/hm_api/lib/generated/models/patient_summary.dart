// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'patient_summary_sex.dart';
import 'patient_summary_status.dart';

part 'patient_summary.g.dart';

@JsonSerializable()
class PatientSummary {
  const PatientSummary({
    required this.birthYear,
    required this.displayName,
    required this.id,
    required this.legalName,
    required this.legalNameBn,
    required this.medicalRecordNumber,
    required this.phoneMasked,
    required this.sex,
    required this.status,
  });
  
  factory PatientSummary.fromJson(Map<String, Object?> json) => _$PatientSummaryFromJson(json);
  
  final int? birthYear;
  final String displayName;
  final String id;
  final String legalName;
  final String? legalNameBn;
  final String medicalRecordNumber;
  final String? phoneMasked;
  final PatientSummarySex? sex;
  final PatientSummaryStatus status;

  Map<String, Object?> toJson() => _$PatientSummaryToJson(this);
}
