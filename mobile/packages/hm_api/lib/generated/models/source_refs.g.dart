// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'source_refs.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SourceRefs _$SourceRefsFromJson(Map<String, dynamic> json) => SourceRefs(
  occurredAt: DateTime.parse(json['occurredAt'] as String),
  sourceId: json['sourceId'] as String,
  sourceType: json['sourceType'] as String,
);

Map<String, dynamic> _$SourceRefsToJson(SourceRefs instance) =>
    <String, dynamic>{
      'occurredAt': instance.occurredAt.toIso8601String(),
      'sourceId': instance.sourceId,
      'sourceType': instance.sourceType,
    };
