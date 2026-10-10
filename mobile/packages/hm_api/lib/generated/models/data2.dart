// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'daily_spend_estimate.dart';
import 'sms_balance_view.dart';
import 'trend.dart';

part 'data2.g.dart';

@JsonSerializable()
class Data2 {
  const Data2({
    required this.dailySpendEstimate,
    required this.latest,
    required this.trend,
    required this.truncated,
  });
  
  factory Data2.fromJson(Map<String, Object?> json) => _$Data2FromJson(json);
  
  final List<DailySpendEstimate> dailySpendEstimate;
  final SmsBalanceView? latest;
  final List<Trend> trend;
  final bool truncated;

  Map<String, Object?> toJson() => _$Data2ToJson(this);
}
