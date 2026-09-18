// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'session_summary_client_type.dart';

part 'session_summary.g.dart';

@JsonSerializable()
class SessionSummary {
  const SessionSummary({
    required this.clientType,
    required this.createdAt,
    required this.current,
    required this.deviceLabel,
    required this.id,
    required this.lastSeenAt,
  });
  
  factory SessionSummary.fromJson(Map<String, Object?> json) => _$SessionSummaryFromJson(json);
  
  final SessionSummaryClientType clientType;
  final DateTime createdAt;
  final bool current;
  final String? deviceLabel;
  final String id;
  final DateTime lastSeenAt;

  Map<String, Object?> toJson() => _$SessionSummaryToJson(this);
}
