// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'data7.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Data7 _$Data7FromJson(Map<String, dynamic> json) => Data7(
  items: (json['items'] as List<dynamic>)
      .map((e) => LabReportView.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$Data7ToJson(Data7 instance) => <String, dynamic>{
  'items': instance.items,
};
