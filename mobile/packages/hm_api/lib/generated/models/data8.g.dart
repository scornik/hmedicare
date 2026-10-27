// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'data8.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Data8 _$Data8FromJson(Map<String, dynamic> json) => Data8(
  items: (json['items'] as List<dynamic>)
      .map((e) => LabReportView.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$Data8ToJson(Data8 instance) => <String, dynamic>{
  'items': instance.items,
};
