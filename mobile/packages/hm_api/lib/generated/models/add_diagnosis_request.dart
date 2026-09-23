// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'add_diagnosis_request_certainty.dart';
import 'add_diagnosis_request_clinical_status.dart';

part 'add_diagnosis_request.g.dart';

@JsonSerializable()
class AddDiagnosisRequest {
  const AddDiagnosisRequest({
    required this.certainty,
    required this.display,
    this.clinicalStatus,
    this.code,
    this.codeSystem,
    this.displayBn,
    this.notes,
    this.replacesDiagnosisId,
  });
  
  factory AddDiagnosisRequest.fromJson(Map<String, Object?> json) => _$AddDiagnosisRequestFromJson(json);
  
  final AddDiagnosisRequestCertainty certainty;
  final AddDiagnosisRequestClinicalStatus? clinicalStatus;
  final String? code;
  final String? codeSystem;
  final String display;
  final String? displayBn;
  final String? notes;

  /// The voided diagnosis this one corrects, so the replacement reads as a correction
  final String? replacesDiagnosisId;

  Map<String, Object?> toJson() => _$AddDiagnosisRequestToJson(this);
}
