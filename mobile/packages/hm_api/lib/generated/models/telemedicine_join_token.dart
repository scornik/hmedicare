// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'telemedicine_join_token_recording_policy.dart';

part 'telemedicine_join_token.g.dart';

@JsonSerializable()
class TelemedicineJoinToken {
  const TelemedicineJoinToken({
    required this.expiresAt,
    required this.participantId,
    required this.provider,
    required this.recordingPolicy,
    required this.sessionId,
    required this.token,
  });
  
  factory TelemedicineJoinToken.fromJson(Map<String, Object?> json) => _$TelemedicineJoinTokenFromJson(json);
  
  final DateTime expiresAt;
  final String participantId;
  final String provider;
  final TelemedicineJoinTokenRecordingPolicy recordingPolicy;
  final String sessionId;
  final String token;

  Map<String, Object?> toJson() => _$TelemedicineJoinTokenToJson(this);
}
