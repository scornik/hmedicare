// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'data2.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Data2 _$Data2FromJson(Map<String, dynamic> json) => Data2(
  items: (json['items'] as List<dynamic>)
      .map((e) => Items.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$Data2ToJson(Data2 instance) => <String, dynamic>{
  'items': instance.items,
};
