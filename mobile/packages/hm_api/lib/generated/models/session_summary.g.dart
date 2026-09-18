// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'session_summary.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SessionSummary _$SessionSummaryFromJson(Map<String, dynamic> json) =>
    SessionSummary(
      clientType: SessionSummaryClientType.fromJson(
        json['clientType'] as String,
      ),
      createdAt: DateTime.parse(json['createdAt'] as String),
      current: json['current'] as bool,
      deviceLabel: json['deviceLabel'] as String?,
      id: json['id'] as String,
      lastSeenAt: DateTime.parse(json['lastSeenAt'] as String),
    );

Map<String, dynamic> _$SessionSummaryToJson(SessionSummary instance) =>
    <String, dynamic>{
      'clientType': instance.clientType,
      'createdAt': instance.createdAt.toIso8601String(),
      'current': instance.current,
      'deviceLabel': instance.deviceLabel,
      'id': instance.id,
      'lastSeenAt': instance.lastSeenAt.toIso8601String(),
    };
