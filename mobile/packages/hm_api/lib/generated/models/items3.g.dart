// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'items3.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Items3 _$Items3FromJson(Map<String, dynamic> json) => Items3(
  actorUserId: json['actorUserId'] as String,
  after: After.fromJson(json['after'] as Map<String, dynamic>),
  before: Before.fromJson(json['before'] as Map<String, dynamic>),
  occurredAt: DateTime.parse(json['occurredAt'] as String),
  policyTextVersion: json['policyTextVersion'] as String,
  policyVersion: (json['policyVersion'] as num).toInt(),
  reason: json['reason'] as String,
  seq: (json['seq'] as num).toInt(),
);

Map<String, dynamic> _$Items3ToJson(Items3 instance) => <String, dynamic>{
  'actorUserId': instance.actorUserId,
  'after': instance.after,
  'before': instance.before,
  'occurredAt': instance.occurredAt.toIso8601String(),
  'policyTextVersion': instance.policyTextVersion,
  'policyVersion': instance.policyVersion,
  'reason': instance.reason,
  'seq': instance.seq,
};
