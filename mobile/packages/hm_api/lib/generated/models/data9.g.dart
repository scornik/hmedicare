// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'data9.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Data9 _$Data9FromJson(Map<String, dynamic> json) => Data9(
  id: json['id'] as String,
  reportId: json['reportId'] as String,
  reviewStatus: ReviewStatus.fromJson(json['reviewStatus'] as String),
);

Map<String, dynamic> _$Data9ToJson(Data9 instance) => <String, dynamic>{
  'id': instance.id,
  'reportId': instance.reportId,
  'reviewStatus': instance.reviewStatus,
};
