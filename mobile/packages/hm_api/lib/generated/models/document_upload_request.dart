// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'document_upload_request_category.dart';

part 'document_upload_request.g.dart';

@JsonSerializable()
class DocumentUploadRequest {
  const DocumentUploadRequest({
    required this.category,
    required this.contentType,
    required this.encounterId,
    required this.patientId,
    required this.sha256,
    required this.sizeBytes,
    this.fileName,
  });
  
  factory DocumentUploadRequest.fromJson(Map<String, Object?> json) => _$DocumentUploadRequestFromJson(json);
  
  final DocumentUploadRequestCategory category;
  final String contentType;
  final String encounterId;
  final String? fileName;
  final String patientId;
  final String sha256;
  final int sizeBytes;

  Map<String, Object?> toJson() => _$DocumentUploadRequestToJson(this);
}
