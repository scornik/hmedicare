// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'diagnosis_certainty.dart';
import 'diagnosis_clinical_status.dart';
import 'diagnosis_source.dart';

part 'diagnosis.g.dart';

@JsonSerializable()
class Diagnosis {
  const Diagnosis({
    required this.authorDoctorProfileId,
    required this.certainty,
    required this.clinicalStatus,
    required this.code,
    required this.codeSystem,
    required this.createdAt,
    required this.display,
    required this.displayBn,
    required this.encounterId,
    required this.id,
    required this.notes,
    required this.patientId,
    required this.replacesDiagnosisId,
    required this.rowVersion,
    required this.source,
    required this.voidReason,
    required this.voidedAt,
  });
  
  factory Diagnosis.fromJson(Map<String, Object?> json) => _$DiagnosisFromJson(json);
  
  final String authorDoctorProfileId;
  final DiagnosisCertainty certainty;
  final DiagnosisClinicalStatus clinicalStatus;
  final String? code;
  final String? codeSystem;
  final DateTime createdAt;
  final String display;
  final String? displayBn;
  final String encounterId;
  final String id;
  final String? notes;
  final String patientId;
  final String? replacesDiagnosisId;
  final int rowVersion;

  /// Always `doctor` in this stage. No code path can produce `ai_approved` before Stage 10
  final DiagnosisSource source;
  final String? voidReason;
  final DateTime? voidedAt;

  Map<String, Object?> toJson() => _$DiagnosisToJson(this);
}
