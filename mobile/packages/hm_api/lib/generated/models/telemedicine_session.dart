// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'telemedicine_session_recording_policy.dart';
import 'telemedicine_session_status.dart';

part 'telemedicine_session.g.dart';

@JsonSerializable()
class TelemedicineSession {
  const TelemedicineSession({
    required this.encounterId,
    required this.endedAt,
    required this.endedReason,
    required this.expiresAt,
    required this.id,
    required this.issuedAt,
    required this.recordingPolicy,
    required this.rowVersion,
    required this.status,
  });
  
  factory TelemedicineSession.fromJson(Map<String, Object?> json) => _$TelemedicineSessionFromJson(json);
  
  final String encounterId;
  final DateTime? endedAt;
  final String? endedReason;
  final DateTime expiresAt;
  final String id;
  final DateTime issuedAt;
  final TelemedicineSessionRecordingPolicy recordingPolicy;
  final int rowVersion;
  final TelemedicineSessionStatus status;

  Map<String, Object?> toJson() => _$TelemedicineSessionToJson(this);
}
