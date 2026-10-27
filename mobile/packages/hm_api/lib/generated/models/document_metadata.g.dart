// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'document_metadata.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DocumentMetadata _$DocumentMetadataFromJson(Map<String, dynamic> json) =>
    DocumentMetadata(
      category: json['category'] as String,
      currentRevision: (json['currentRevision'] as num?)?.toInt(),
      id: json['id'] as String,
      status: DocumentMetadataStatus.fromJson(json['status'] as String),
      title: json['title'] as String?,
    );

Map<String, dynamic> _$DocumentMetadataToJson(DocumentMetadata instance) =>
    <String, dynamic>{
      'category': instance.category,
      'currentRevision': ?instance.currentRevision,
      'id': instance.id,
      'status': instance.status,
      'title': ?instance.title,
    };
