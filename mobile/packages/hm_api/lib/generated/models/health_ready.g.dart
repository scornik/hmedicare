// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'health_ready.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

HealthReady _$HealthReadyFromJson(Map<String, dynamic> json) => HealthReady(
  checks: (json['checks'] as Map<String, dynamic>).map(
    (k, e) => MapEntry(k, ChecksChecks.fromJson(e as String)),
  ),
  status: HealthReadyStatus.fromJson(json['status'] as String),
);

Map<String, dynamic> _$HealthReadyToJson(HealthReady instance) =>
    <String, dynamic>{'checks': instance.checks, 'status': instance.status};
