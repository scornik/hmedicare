// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'encounter.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Encounter _$EncounterFromJson(Map<String, dynamic> json) => Encounter(
  appointmentId: json['appointmentId'] as String?,
  careMode: EncounterCareMode.fromJson(json['careMode'] as String),
  chamberId: json['chamberId'] as String,
  completedAt: json['completedAt'] == null
      ? null
      : DateTime.parse(json['completedAt'] as String),
  coveringDoctorProfileId: json['coveringDoctorProfileId'] as String?,
  doctorProfileId: json['doctorProfileId'] as String,
  id: json['id'] as String,
  interruptedAt: json['interruptedAt'] == null
      ? null
      : DateTime.parse(json['interruptedAt'] as String),
  legacyInterim: json['legacyInterim'] as bool,
  patientId: json['patientId'] as String,
  resumedAt: json['resumedAt'] == null
      ? null
      : DateTime.parse(json['resumedAt'] as String),
  rowVersion: (json['rowVersion'] as num).toInt(),
  serialId: json['serialId'] as String,
  startedAt: DateTime.parse(json['startedAt'] as String),
  status: EncounterStatus.fromJson(json['status'] as String),
);

Map<String, dynamic> _$EncounterToJson(Encounter instance) => <String, dynamic>{
  'appointmentId': ?instance.appointmentId,
  'careMode': instance.careMode,
  'chamberId': instance.chamberId,
  'completedAt': ?instance.completedAt?.toIso8601String(),
  'coveringDoctorProfileId': ?instance.coveringDoctorProfileId,
  'doctorProfileId': instance.doctorProfileId,
  'id': instance.id,
  'interruptedAt': ?instance.interruptedAt?.toIso8601String(),
  'legacyInterim': instance.legacyInterim,
  'patientId': instance.patientId,
  'resumedAt': ?instance.resumedAt?.toIso8601String(),
  'rowVersion': instance.rowVersion,
  'serialId': instance.serialId,
  'startedAt': instance.startedAt.toIso8601String(),
  'status': instance.status,
};
