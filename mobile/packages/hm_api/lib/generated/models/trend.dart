// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'sms_balance_parse_status.dart';

part 'trend.g.dart';

@JsonSerializable()
class Trend {
  const Trend({
    required this.balance,
    required this.checkedAt,
    required this.parseStatus,
  });
  
  factory Trend.fromJson(Map<String, Object?> json) => _$TrendFromJson(json);
  
  final String? balance;
  final DateTime checkedAt;
  final SmsBalanceParseStatus parseStatus;

  Map<String, Object?> toJson() => _$TrendToJson(this);
}
