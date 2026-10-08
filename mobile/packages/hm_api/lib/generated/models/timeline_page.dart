// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'timeline_entry.dart';

part 'timeline_page.g.dart';

@JsonSerializable()
class TimelinePage {
  const TimelinePage({
    required this.items,
    required this.nextCursor,
    required this.projectionVersion,
    required this.stale,
  });
  
  factory TimelinePage.fromJson(Map<String, Object?> json) => _$TimelinePageFromJson(json);
  
  final List<TimelineEntry> items;
  final String? nextCursor;
  final int projectionVersion;
  final bool stale;

  Map<String, Object?> toJson() => _$TimelinePageToJson(this);
}
