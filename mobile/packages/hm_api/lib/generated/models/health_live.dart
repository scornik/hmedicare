// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'health_live_app.dart';
import 'health_live_status.dart';

part 'health_live.g.dart';

@JsonSerializable()
class HealthLive {
  const HealthLive({
    required this.app,
    required this.bootId,
    required this.status,
    required this.uptimeSeconds,
    required this.version,
  });
  
  factory HealthLive.fromJson(Map<String, Object?> json) => _$HealthLiveFromJson(json);
  
  final HealthLiveApp app;
  final String bootId;
  final HealthLiveStatus status;
  final int uptimeSeconds;
  final String version;

  Map<String, Object?> toJson() => _$HealthLiveToJson(this);
}
