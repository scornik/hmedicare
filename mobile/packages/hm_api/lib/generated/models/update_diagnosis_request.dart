// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'update_diagnosis_request_certainty.dart';
import 'update_diagnosis_request_clinical_status.dart';

part 'update_diagnosis_request.g.dart';

@JsonSerializable()
class UpdateDiagnosisRequest {
  const UpdateDiagnosisRequest({
    required this.expectedRowVersion,
    this.certainty,
    this.clinicalStatus,
    this.code,
    this.codeSystem,
    this.display,
    this.displayBn,
    this.notes,
  });
  
  factory UpdateDiagnosisRequest.fromJson(Map<String, Object?> json) => _$UpdateDiagnosisRequestFromJson(json);
  
  final UpdateDiagnosisRequestCertainty? certainty;
  final UpdateDiagnosisRequestClinicalStatus? clinicalStatus;
  final String? code;
  final String? codeSystem;
  final String? display;
  final String? displayBn;
  final int expectedRowVersion;
  final String? notes;

  Map<String, Object?> toJson() => _$UpdateDiagnosisRequestToJson(this);
}
