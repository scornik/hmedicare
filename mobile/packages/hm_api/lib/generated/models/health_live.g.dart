// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'health_live.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

HealthLive _$HealthLiveFromJson(Map<String, dynamic> json) => HealthLive(
  app: HealthLiveApp.fromJson(json['app'] as String),
  bootId: json['bootId'] as String,
  status: HealthLiveStatus.fromJson(json['status'] as String),
  uptimeSeconds: (json['uptimeSeconds'] as num).toInt(),
  version: json['version'] as String,
);

Map<String, dynamic> _$HealthLiveToJson(HealthLive instance) =>
    <String, dynamic>{
      'app': instance.app,
      'bootId': instance.bootId,
      'status': instance.status,
      'uptimeSeconds': instance.uptimeSeconds,
      'version': instance.version,
    };
