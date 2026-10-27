// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'document_upload_session.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DocumentUploadSession _$DocumentUploadSessionFromJson(
  Map<String, dynamic> json,
) => DocumentUploadSession(
  documentId: json['documentId'] as String,
  expiresAt: DateTime.parse(json['expiresAt'] as String),
  mode: DocumentUploadSessionMode.fromJson(json['mode'] as String),
  partCount: (json['partCount'] as num).toInt(),
  partSizeBytes: (json['partSizeBytes'] as num).toInt(),
  sessionId: json['sessionId'] as String,
);

Map<String, dynamic> _$DocumentUploadSessionToJson(
  DocumentUploadSession instance,
) => <String, dynamic>{
  'documentId': instance.documentId,
  'expiresAt': instance.expiresAt.toIso8601String(),
  'mode': instance.mode,
  'partCount': instance.partCount,
  'partSizeBytes': instance.partSizeBytes,
  'sessionId': instance.sessionId,
};
