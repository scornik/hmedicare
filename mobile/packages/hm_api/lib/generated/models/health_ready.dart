// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'checks_checks.dart';
import 'health_ready_status.dart';

part 'health_ready.g.dart';

@JsonSerializable()
class HealthReady {
  const HealthReady({
    required this.checks,
    required this.status,
  });
  
  factory HealthReady.fromJson(Map<String, Object?> json) => _$HealthReadyFromJson(json);
  
  final Map<String, ChecksChecks> checks;
  final HealthReadyStatus status;

  Map<String, Object?> toJson() => _$HealthReadyToJson(this);
}
