// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'symptom_observation_certainty.dart';
import 'symptom_observation_severity.dart';
import 'symptom_observation_source.dart';
import 'symptom_observation_status.dart';

part 'symptom_observation.g.dart';

@JsonSerializable()
class SymptomObservation {
  const SymptomObservation({
    required this.certainty,
    required this.codeSystem,
    required this.createdAt,
    required this.detail,
    required this.display,
    required this.encounterId,
    required this.id,
    required this.normalizedCode,
    required this.onset,
    required this.patientId,
    required this.rowVersion,
    required this.severity,
    required this.source,
    required this.status,
  });
  
  factory SymptomObservation.fromJson(Map<String, Object?> json) => _$SymptomObservationFromJson(json);
  
  final SymptomObservationCertainty certainty;
  final String? codeSystem;
  final DateTime createdAt;
  final String? detail;
  final String display;
  final String encounterId;
  final String id;
  final String? normalizedCode;
  final String? onset;
  final String patientId;
  final int rowVersion;
  final SymptomObservationSeverity? severity;
  final SymptomObservationSource source;
  final SymptomObservationStatus status;

  Map<String, Object?> toJson() => _$SymptomObservationToJson(this);
}
