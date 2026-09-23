// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'queue_entry.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

QueueEntry _$QueueEntryFromJson(Map<String, dynamic> json) => QueueEntry(
  careMode: QueueEntryCareMode.fromJson(json['careMode'] as String),
  duplicateOverride: json['duplicateOverride'] as bool,
  encounterId: json['encounterId'] as String?,
  lateArrival: json['lateArrival'] as bool,
  medicalRecordNumber: json['medicalRecordNumber'] as String,
  patientDisplayName: json['patientDisplayName'] as String,
  patientId: json['patientId'] as String,
  queuePosition: (json['queuePosition'] as num?)?.toInt(),
  recallCount: (json['recallCount'] as num).toInt(),
  recallDeadlineAt: json['recallDeadlineAt'] == null
      ? null
      : DateTime.parse(json['recallDeadlineAt'] as String),
  remoteReady: json['remoteReady'] as bool,
  rowVersion: (json['rowVersion'] as num).toInt(),
  serialId: json['serialId'] as String,
  serialNumber: (json['serialNumber'] as num).toInt(),
  source: QueueEntrySource.fromJson(json['source'] as String),
  status: QueueEntryStatus.fromJson(json['status'] as String),
);

Map<String, dynamic> _$QueueEntryToJson(QueueEntry instance) =>
    <String, dynamic>{
      'careMode': instance.careMode,
      'duplicateOverride': instance.duplicateOverride,
      'encounterId': ?instance.encounterId,
      'lateArrival': instance.lateArrival,
      'medicalRecordNumber': instance.medicalRecordNumber,
      'patientDisplayName': instance.patientDisplayName,
      'patientId': instance.patientId,
      'queuePosition': ?instance.queuePosition,
      'recallCount': instance.recallCount,
      'recallDeadlineAt': ?instance.recallDeadlineAt?.toIso8601String(),
      'remoteReady': instance.remoteReady,
      'rowVersion': instance.rowVersion,
      'serialId': instance.serialId,
      'serialNumber': instance.serialNumber,
      'source': instance.source,
      'status': instance.status,
    };
