// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'medication_import.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MedicationImport _$MedicationImportFromJson(Map<String, dynamic> json) =>
    MedicationImport(
      checkpoint: json['checkpoint'] == null
          ? null
          : Checkpoint.fromJson(json['checkpoint'] as Map<String, dynamic>),
      counts: json['counts'] as Map<String, dynamic>,
      createdAt: DateTime.parse(json['createdAt'] as String),
      datasetStatus: json['datasetStatus'] as String,
      datasetVersion: json['datasetVersion'] as String,
      environment: json['environment'] as String,
      errorClass: json['errorClass'] as String?,
      executionPath: MedicationImportExecutionPath.fromJson(
        json['executionPath'] as String,
      ),
      finishedAt: json['finishedAt'] == null
          ? null
          : DateTime.parse(json['finishedAt'] as String),
      importId: json['importId'] as String,
      refusalReason: json['refusalReason'] as String?,
      requestedBy: json['requestedBy'] as String,
      startedAt: json['startedAt'] == null
          ? null
          : DateTime.parse(json['startedAt'] as String),
      status: MedicationImportStatus.fromJson(json['status'] as String),
    );

Map<String, dynamic> _$MedicationImportToJson(MedicationImport instance) =>
    <String, dynamic>{
      'checkpoint': ?instance.checkpoint,
      'counts': instance.counts,
      'createdAt': instance.createdAt.toIso8601String(),
      'datasetStatus': instance.datasetStatus,
      'datasetVersion': instance.datasetVersion,
      'environment': instance.environment,
      'errorClass': ?instance.errorClass,
      'executionPath': instance.executionPath,
      'finishedAt': ?instance.finishedAt?.toIso8601String(),
      'importId': instance.importId,
      'refusalReason': ?instance.refusalReason,
      'requestedBy': instance.requestedBy,
      'startedAt': ?instance.startedAt?.toIso8601String(),
      'status': instance.status,
    };
