// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'gates.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Gates _$GatesFromJson(Map<String, dynamic> json) => Gates(
  attested: json['attested'] as bool,
  gateCode: GateCode.fromJson(json['gateCode'] as String),
  recordedAt: json['recordedAt'] == null
      ? null
      : DateTime.parse(json['recordedAt'] as String),
  recordedByUserId: json['recordedByUserId'] as String?,
);

Map<String, dynamic> _$GatesToJson(Gates instance) => <String, dynamic>{
  'attested': instance.attested,
  'gateCode': instance.gateCode,
  'recordedAt': ?instance.recordedAt?.toIso8601String(),
  'recordedByUserId': ?instance.recordedByUserId,
};
