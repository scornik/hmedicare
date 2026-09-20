// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'queue_snapshot.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

QueueSnapshot _$QueueSnapshotFromJson(Map<String, dynamic> json) =>
    QueueSnapshot(
      asOf: DateTime.parse(json['asOf'] as String),
      avgConsultationMinutes: (json['avgConsultationMinutes'] as num).toInt(),
      chamberDayId: json['chamberDayId'] as String,
      counts: Counts2.fromJson(json['counts'] as Map<String, dynamic>),
      entries: (json['entries'] as List<dynamic>)
          .map((e) => QueueEntry.fromJson(e as Map<String, dynamic>))
          .toList(),
      etag: json['etag'] as String,
      expectedDelayMinutes: (json['expectedDelayMinutes'] as num?)?.toInt(),
      localDate: json['localDate'] as String,
      queueOrderVersion: (json['queueOrderVersion'] as num).toInt(),
      status: QueueSnapshotStatus.fromJson(json['status'] as String),
    );

Map<String, dynamic> _$QueueSnapshotToJson(QueueSnapshot instance) =>
    <String, dynamic>{
      'asOf': instance.asOf.toIso8601String(),
      'avgConsultationMinutes': instance.avgConsultationMinutes,
      'chamberDayId': instance.chamberDayId,
      'counts': instance.counts,
      'entries': instance.entries,
      'etag': instance.etag,
      'expectedDelayMinutes': ?instance.expectedDelayMinutes,
      'localDate': instance.localDate,
      'queueOrderVersion': instance.queueOrderVersion,
      'status': instance.status,
    };
