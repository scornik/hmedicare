// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'encounter_summary_care_mode.dart';
import 'encounter_summary_status.dart';

part 'encounter_summary.g.dart';

@JsonSerializable()
class EncounterSummary {
  const EncounterSummary({
    required this.careMode,
    required this.chamberId,
    required this.completedAt,
    required this.doctorProfileId,
    required this.id,
    required this.legacyInterim,
    required this.signedRevisions,
    required this.startedAt,
    required this.status,
  });
  
  factory EncounterSummary.fromJson(Map<String, Object?> json) => _$EncounterSummaryFromJson(json);
  
  final EncounterSummaryCareMode careMode;
  final String chamberId;
  final DateTime? completedAt;
  final String doctorProfileId;
  final String id;
  final bool legacyInterim;

  /// 0 when nothing was ever signed: an abandoned consultation, or a legacy ADR-021 row
  final int signedRevisions;
  final DateTime startedAt;
  final EncounterSummaryStatus status;

  Map<String, Object?> toJson() => _$EncounterSummaryToJson(this);
}
