// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'queue_entry_care_mode.dart';
import 'queue_entry_source.dart';
import 'queue_entry_status.dart';

part 'queue_entry.g.dart';

@JsonSerializable()
class QueueEntry {
  const QueueEntry({
    required this.careMode,
    required this.duplicateOverride,
    required this.encounterId,
    required this.lateArrival,
    required this.medicalRecordNumber,
    required this.patientDisplayName,
    required this.patientId,
    required this.queuePosition,
    required this.recallCount,
    required this.recallDeadlineAt,
    required this.remoteReady,
    required this.rowVersion,
    required this.serialId,
    required this.serialNumber,
    required this.source,
    required this.status,
  });
  
  factory QueueEntry.fromJson(Map<String, Object?> json) => _$QueueEntryFromJson(json);
  
  final QueueEntryCareMode careMode;
  final bool duplicateOverride;

  /// The consultation started from this serial, once there is one. The board follows it to `/encounters/{id}` rather than acting on the serial itself
  final String? encounterId;
  final bool lateArrival;
  final String medicalRecordNumber;
  final String patientDisplayName;
  final String patientId;
  final int? queuePosition;
  final int recallCount;
  final DateTime? recallDeadlineAt;
  final bool remoteReady;
  final int rowVersion;
  final String serialId;
  final int serialNumber;
  final QueueEntrySource source;
  final QueueEntryStatus status;

  Map<String, Object?> toJson() => _$QueueEntryToJson(this);
}
