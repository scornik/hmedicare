// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'items2.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Items2 _$Items2FromJson(Map<String, dynamic> json) => Items2(
  category: json['category'] as String,
  createdAt: DateTime.parse(json['createdAt'] as String),
  id: json['id'] as String,
  title: json['title'] as String?,
);

Map<String, dynamic> _$Items2ToJson(Items2 instance) => <String, dynamic>{
  'category': instance.category,
  'createdAt': instance.createdAt.toIso8601String(),
  'id': instance.id,
  'title': ?instance.title,
};
