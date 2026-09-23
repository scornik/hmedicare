// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'note_section_source.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

NoteSectionSource _$NoteSectionSourceFromJson(Map<String, dynamic> json) =>
    NoteSectionSource(
      section: NoteSectionSourceSection.fromJson(json['section'] as String),
      source: NoteSectionSourceSource.fromJson(json['source'] as String),
      aiApprovalId: json['aiApprovalId'] as String?,
    );

Map<String, dynamic> _$NoteSectionSourceToJson(NoteSectionSource instance) =>
    <String, dynamic>{
      'aiApprovalId': ?instance.aiApprovalId,
      'section': instance.section,
      'source': instance.source,
    };
