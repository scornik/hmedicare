// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'telemedicine_join_token.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

TelemedicineJoinToken _$TelemedicineJoinTokenFromJson(
  Map<String, dynamic> json,
) => TelemedicineJoinToken(
  expiresAt: DateTime.parse(json['expiresAt'] as String),
  participantId: json['participantId'] as String,
  provider: json['provider'] as String,
  recordingPolicy: TelemedicineJoinTokenRecordingPolicy.fromJson(
    json['recordingPolicy'] as String,
  ),
  sessionId: json['sessionId'] as String,
  token: json['token'] as String,
);

Map<String, dynamic> _$TelemedicineJoinTokenToJson(
  TelemedicineJoinToken instance,
) => <String, dynamic>{
  'expiresAt': instance.expiresAt.toIso8601String(),
  'participantId': instance.participantId,
  'provider': instance.provider,
  'recordingPolicy': instance.recordingPolicy,
  'sessionId': instance.sessionId,
  'token': instance.token,
};
