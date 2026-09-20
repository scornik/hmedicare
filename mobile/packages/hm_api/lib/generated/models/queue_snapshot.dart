// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'counts2.dart';
import 'queue_entry.dart';
import 'queue_snapshot_status.dart';

part 'queue_snapshot.g.dart';

@JsonSerializable()
class QueueSnapshot {
  const QueueSnapshot({
    required this.asOf,
    required this.avgConsultationMinutes,
    required this.chamberDayId,
    required this.counts,
    required this.entries,
    required this.etag,
    required this.expectedDelayMinutes,
    required this.localDate,
    required this.queueOrderVersion,
    required this.status,
  });
  
  factory QueueSnapshot.fromJson(Map<String, Object?> json) => _$QueueSnapshotFromJson(json);
  
  final DateTime asOf;
  final int avgConsultationMinutes;
  final String chamberDayId;
  final Counts2 counts;
  final List<QueueEntry> entries;

  /// Strong ETag over the snapshot body (QUEUE §3.5 polling)
  final String etag;
  final int? expectedDelayMinutes;

  /// Calendar date (no time zone)
  final String localDate;
  final int queueOrderVersion;
  final QueueSnapshotStatus status;

  Map<String, Object?> toJson() => _$QueueSnapshotToJson(this);
}
