// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_approved_diagnosis_certainty.dart';
import 'ai_approved_diagnosis_clinical_status.dart';

part 'ai_approved_diagnosis.g.dart';

@JsonSerializable()
class AiApprovedDiagnosis {
  const AiApprovedDiagnosis({
    required this.certainty,
    required this.display,
    this.clinicalStatus,
    this.code,
    this.codeSystem,
    this.displayBn,
    this.notes,
  });
  
  factory AiApprovedDiagnosis.fromJson(Map<String, Object?> json) => _$AiApprovedDiagnosisFromJson(json);
  
  final AiApprovedDiagnosisCertainty certainty;
  final AiApprovedDiagnosisClinicalStatus? clinicalStatus;
  final String? code;
  final String? codeSystem;
  final String display;
  final String? displayBn;
  final String? notes;

  Map<String, Object?> toJson() => _$AiApprovedDiagnosisToJson(this);
}
