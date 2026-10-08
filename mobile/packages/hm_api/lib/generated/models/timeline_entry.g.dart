// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'timeline_entry.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

TimelineEntry _$TimelineEntryFromJson(Map<String, dynamic> json) =>
    TimelineEntry(
      eventType: json['eventType'] as String,
      id: json['id'] as String,
      occurredAt: DateTime.parse(json['occurredAt'] as String),
      source: json['source'] == null
          ? null
          : Source2.fromJson(json['source'] as Map<String, dynamic>),
      summary: json['summary'] as String,
      visibility: TimelineEntryVisibility.fromJson(
        json['visibility'] as String,
      ),
    );

Map<String, dynamic> _$TimelineEntryToJson(TimelineEntry instance) =>
    <String, dynamic>{
      'eventType': instance.eventType,
      'id': instance.id,
      'occurredAt': instance.occurredAt.toIso8601String(),
      'source': ?instance.source,
      'summary': instance.summary,
      'visibility': instance.visibility,
    };
