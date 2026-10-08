// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'source2.dart';
import 'timeline_entry_visibility.dart';

part 'timeline_entry.g.dart';

@JsonSerializable()
class TimelineEntry {
  const TimelineEntry({
    required this.eventType,
    required this.id,
    required this.occurredAt,
    required this.source,
    required this.summary,
    required this.visibility,
  });
  
  factory TimelineEntry.fromJson(Map<String, Object?> json) => _$TimelineEntryFromJson(json);
  
  final String eventType;
  final String id;
  final DateTime occurredAt;
  final Source2? source;
  final String summary;
  final TimelineEntryVisibility visibility;

  Map<String, Object?> toJson() => _$TimelineEntryToJson(this);
}
