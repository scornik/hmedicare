// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'data11.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Data11 _$Data11FromJson(Map<String, dynamic> json) => Data11(
  dailySpendEstimate: (json['dailySpendEstimate'] as List<dynamic>)
      .map((e) => DailySpendEstimate.fromJson(e as Map<String, dynamic>))
      .toList(),
  latest: json['latest'] == null
      ? null
      : SmsBalanceView.fromJson(json['latest'] as Map<String, dynamic>),
  trend: (json['trend'] as List<dynamic>)
      .map((e) => Trend.fromJson(e as Map<String, dynamic>))
      .toList(),
  truncated: json['truncated'] as bool,
);

Map<String, dynamic> _$Data11ToJson(Data11 instance) => <String, dynamic>{
  'dailySpendEstimate': instance.dailySpendEstimate,
  'latest': ?instance.latest,
  'trend': instance.trend,
  'truncated': instance.truncated,
};
