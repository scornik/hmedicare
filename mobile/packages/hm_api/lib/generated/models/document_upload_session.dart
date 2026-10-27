// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'document_upload_session_mode.dart';

part 'document_upload_session.g.dart';

@JsonSerializable()
class DocumentUploadSession {
  const DocumentUploadSession({
    required this.documentId,
    required this.expiresAt,
    required this.mode,
    required this.partCount,
    required this.partSizeBytes,
    required this.sessionId,
  });
  
  factory DocumentUploadSession.fromJson(Map<String, Object?> json) => _$DocumentUploadSessionFromJson(json);
  
  final String documentId;
  final DateTime expiresAt;
  final DocumentUploadSessionMode mode;
  final int partCount;
  final int partSizeBytes;
  final String sessionId;

  Map<String, Object?> toJson() => _$DocumentUploadSessionToJson(this);
}
