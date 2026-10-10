// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'telemedicine_session.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

TelemedicineSession _$TelemedicineSessionFromJson(Map<String, dynamic> json) =>
    TelemedicineSession(
      encounterId: json['encounterId'] as String,
      endedAt: json['endedAt'] == null
          ? null
          : DateTime.parse(json['endedAt'] as String),
      endedReason: json['endedReason'] as String?,
      expiresAt: DateTime.parse(json['expiresAt'] as String),
      id: json['id'] as String,
      issuedAt: DateTime.parse(json['issuedAt'] as String),
      recordingPolicy: TelemedicineSessionRecordingPolicy.fromJson(
        json['recordingPolicy'] as String,
      ),
      rowVersion: (json['rowVersion'] as num).toInt(),
      status: TelemedicineSessionStatus.fromJson(json['status'] as String),
    );

Map<String, dynamic> _$TelemedicineSessionToJson(
  TelemedicineSession instance,
) => <String, dynamic>{
  'encounterId': instance.encounterId,
  'endedAt': ?instance.endedAt?.toIso8601String(),
  'endedReason': ?instance.endedReason,
  'expiresAt': instance.expiresAt.toIso8601String(),
  'id': instance.id,
  'issuedAt': instance.issuedAt.toIso8601String(),
  'recordingPolicy': instance.recordingPolicy,
  'rowVersion': instance.rowVersion,
  'status': instance.status,
};
