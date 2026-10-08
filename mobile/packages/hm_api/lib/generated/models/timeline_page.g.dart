// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'timeline_page.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

TimelinePage _$TimelinePageFromJson(Map<String, dynamic> json) => TimelinePage(
  items: (json['items'] as List<dynamic>)
      .map((e) => TimelineEntry.fromJson(e as Map<String, dynamic>))
      .toList(),
  nextCursor: json['nextCursor'] as String?,
  projectionVersion: (json['projectionVersion'] as num).toInt(),
  stale: json['stale'] as bool,
);

Map<String, dynamic> _$TimelinePageToJson(TimelinePage instance) =>
    <String, dynamic>{
      'items': instance.items,
      'nextCursor': ?instance.nextCursor,
      'projectionVersion': instance.projectionVersion,
      'stale': instance.stale,
    };
