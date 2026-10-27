// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'data6.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Data6 _$Data6FromJson(Map<String, dynamic> json) => Data6(
  partNumber: (json['partNumber'] as num).toInt(),
  sha256: json['sha256'] as String,
  sizeBytes: (json['sizeBytes'] as num).toInt(),
);

Map<String, dynamic> _$Data6ToJson(Data6 instance) => <String, dynamic>{
  'partNumber': instance.partNumber,
  'sha256': instance.sha256,
  'sizeBytes': instance.sizeBytes,
};
