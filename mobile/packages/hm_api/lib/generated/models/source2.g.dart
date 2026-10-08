// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'source2.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Source2 _$Source2FromJson(Map<String, dynamic> json) => Source2(
  aggregateId: json['aggregateId'] as String,
  encounterId: json['encounterId'] as String?,
  id: json['id'] as String,
  type: json['type'] as String,
);

Map<String, dynamic> _$Source2ToJson(Source2 instance) => <String, dynamic>{
  'aggregateId': instance.aggregateId,
  'encounterId': ?instance.encounterId,
  'id': instance.id,
  'type': instance.type,
};
