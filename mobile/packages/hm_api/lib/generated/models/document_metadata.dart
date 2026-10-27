// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'document_metadata_status.dart';

part 'document_metadata.g.dart';

@JsonSerializable()
class DocumentMetadata {
  const DocumentMetadata({
    required this.category,
    required this.currentRevision,
    required this.id,
    required this.status,
    required this.title,
  });
  
  factory DocumentMetadata.fromJson(Map<String, Object?> json) => _$DocumentMetadataFromJson(json);
  
  final String category;
  final int? currentRevision;
  final String id;
  final DocumentMetadataStatus status;
  final String? title;

  Map<String, Object?> toJson() => _$DocumentMetadataToJson(this);
}
