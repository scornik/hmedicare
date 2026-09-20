// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'chamber_day.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ChamberDay _$ChamberDayFromJson(Map<String, dynamic> json) => ChamberDay(
  chamberId: json['chamberId'] as String,
  closedAt: json['closedAt'] == null
      ? null
      : DateTime.parse(json['closedAt'] as String),
  createdAt: DateTime.parse(json['createdAt'] as String),
  doctorProfileId: json['doctorProfileId'] as String,
  expectedDelayMinutes: (json['expectedDelayMinutes'] as num?)?.toInt(),
  id: json['id'] as String,
  localDate: json['localDate'] as String,
  localEndTime: json['localEndTime'] as String,
  localStartTime: json['localStartTime'] as String,
  nextSerialNumber: (json['nextSerialNumber'] as num).toInt(),
  queueOrderVersion: (json['queueOrderVersion'] as num).toInt(),
  queuePolicy: QueuePolicy.fromJson(
    json['queuePolicy'] as Map<String, dynamic>,
  ),
  rowVersion: (json['rowVersion'] as num).toInt(),
  status: ChamberDayStatus.fromJson(json['status'] as String),
  timezone: json['timezone'] as String,
  updatedAt: DateTime.parse(json['updatedAt'] as String),
);

Map<String, dynamic> _$ChamberDayToJson(ChamberDay instance) =>
    <String, dynamic>{
      'chamberId': instance.chamberId,
      'closedAt': ?instance.closedAt?.toIso8601String(),
      'createdAt': instance.createdAt.toIso8601String(),
      'doctorProfileId': instance.doctorProfileId,
      'expectedDelayMinutes': ?instance.expectedDelayMinutes,
      'id': instance.id,
      'localDate': instance.localDate,
      'localEndTime': instance.localEndTime,
      'localStartTime': instance.localStartTime,
      'nextSerialNumber': instance.nextSerialNumber,
      'queueOrderVersion': instance.queueOrderVersion,
      'queuePolicy': instance.queuePolicy,
      'rowVersion': instance.rowVersion,
      'status': instance.status,
      'timezone': instance.timezone,
      'updatedAt': instance.updatedAt.toIso8601String(),
    };
