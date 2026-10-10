// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'trend.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Trend _$TrendFromJson(Map<String, dynamic> json) => Trend(
  balance: json['balance'] as String?,
  checkedAt: DateTime.parse(json['checkedAt'] as String),
  parseStatus: SmsBalanceParseStatus.fromJson(json['parseStatus'] as String),
);

Map<String, dynamic> _$TrendToJson(Trend instance) => <String, dynamic>{
  'balance': ?instance.balance,
  'checkedAt': instance.checkedAt.toIso8601String(),
  'parseStatus': instance.parseStatus,
};
