// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'document_upload_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DocumentUploadRequest _$DocumentUploadRequestFromJson(
  Map<String, dynamic> json,
) => DocumentUploadRequest(
  category: DocumentUploadRequestCategory.fromJson(json['category'] as String),
  contentType: json['contentType'] as String,
  encounterId: json['encounterId'] as String,
  patientId: json['patientId'] as String,
  sha256: json['sha256'] as String,
  sizeBytes: (json['sizeBytes'] as num).toInt(),
  fileName: json['fileName'] as String?,
);

Map<String, dynamic> _$DocumentUploadRequestToJson(
  DocumentUploadRequest instance,
) => <String, dynamic>{
  'category': instance.category,
  'contentType': instance.contentType,
  'encounterId': instance.encounterId,
  'fileName': ?instance.fileName,
  'patientId': instance.patientId,
  'sha256': instance.sha256,
  'sizeBytes': instance.sizeBytes,
};
