// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'checkpoint.dart';
import 'medication_import_execution_path.dart';
import 'medication_import_status.dart';

part 'medication_import.g.dart';

@JsonSerializable()
class MedicationImport {
  const MedicationImport({
    required this.checkpoint,
    required this.counts,
    required this.createdAt,
    required this.datasetStatus,
    required this.datasetVersion,
    required this.environment,
    required this.errorClass,
    required this.executionPath,
    required this.finishedAt,
    required this.importId,
    required this.refusalReason,
    required this.requestedBy,
    required this.startedAt,
    required this.status,
  });
  
  factory MedicationImport.fromJson(Map<String, Object?> json) => _$MedicationImportFromJson(json);
  
  /// Where a failed run stopped; a later run resumes from here
  final Checkpoint? checkpoint;

  /// Totals and a per-file breakdown: read, inserted, updated, unchanged, rejected, skipped
  final Map<String, dynamic> counts;
  final DateTime createdAt;

  /// The dataset's own review status, read from its records. UNVERIFIED for Stage M
  final String datasetStatus;
  final String datasetVersion;
  final String environment;
  final String? errorClass;
  final MedicationImportExecutionPath executionPath;
  final DateTime? finishedAt;
  final String importId;

  /// MEDDATA_PRODUCTION_GATES_OPEN when production gates are not all attested
  final String? refusalReason;

  /// Operator user id, or the CLI operating-system user
  final String requestedBy;
  final DateTime? startedAt;
  final MedicationImportStatus status;

  Map<String, Object?> toJson() => _$MedicationImportToJson(this);
}
