// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'daily_spend_estimate.dart';
import 'sms_balance_view.dart';
import 'trend.dart';

part 'data11.g.dart';

@JsonSerializable()
class Data11 {
  const Data11({
    required this.dailySpendEstimate,
    required this.latest,
    required this.trend,
    required this.truncated,
  });
  
  factory Data11.fromJson(Map<String, Object?> json) => _$Data11FromJson(json);
  
  final List<DailySpendEstimate> dailySpendEstimate;
  final SmsBalanceView? latest;
  final List<Trend> trend;
  final bool truncated;

  Map<String, Object?> toJson() => _$Data11ToJson(this);
}
