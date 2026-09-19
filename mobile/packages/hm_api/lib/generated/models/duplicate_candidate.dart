// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'duplicate_candidate_reasons.dart';
import 'patient_summary.dart';

part 'duplicate_candidate.g.dart';

@JsonSerializable()
class DuplicateCandidate {
  const DuplicateCandidate({
    required this.patient,
    required this.reasons,
    required this.score,
  });
  
  factory DuplicateCandidate.fromJson(Map<String, Object?> json) => _$DuplicateCandidateFromJson(json);
  
  final PatientSummary patient;
  final List<DuplicateCandidateReasons> reasons;
  final num score;

  Map<String, Object?> toJson() => _$DuplicateCandidateToJson(this);
}
