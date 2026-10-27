// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'items.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Items _$ItemsFromJson(Map<String, dynamic> json) => Items(
  id: json['id'] as String,
  startedAt: DateTime.parse(json['startedAt'] as String),
  status: Status3.fromJson(json['status'] as String),
);

Map<String, dynamic> _$ItemsToJson(Items instance) => <String, dynamic>{
  'id': instance.id,
  'startedAt': instance.startedAt.toIso8601String(),
  'status': instance.status,
};
