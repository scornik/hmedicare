// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'source.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Source _$SourceFromJson(Map<String, dynamic> json) => Source(
  datasetVersion: json['datasetVersion'] as String,
  dgdaMatch: json['dgdaMatch'] as String,
  isSynthetic: json['isSynthetic'] as bool,
  reviewStatus: json['reviewStatus'] as String,
);

Map<String, dynamic> _$SourceToJson(Source instance) => <String, dynamic>{
  'datasetVersion': instance.datasetVersion,
  'dgdaMatch': instance.dgdaMatch,
  'isSynthetic': instance.isSynthetic,
  'reviewStatus': instance.reviewStatus,
};
