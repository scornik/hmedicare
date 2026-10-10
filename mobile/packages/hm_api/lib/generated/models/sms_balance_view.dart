// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'sms_balance_parse_status.dart';

part 'sms_balance_view.g.dart';

@JsonSerializable()
class SmsBalanceView {
  const SmsBalanceView({
    required this.balance,
    required this.checkedAt,
    required this.currencyText,
    required this.errorClass,
    required this.parseStatus,
  });
  
  factory SmsBalanceView.fromJson(Map<String, Object?> json) => _$SmsBalanceViewFromJson(json);
  
  final String? balance;
  final DateTime checkedAt;
  final String? currencyText;
  final String? errorClass;
  final SmsBalanceParseStatus parseStatus;

  Map<String, Object?> toJson() => _$SmsBalanceViewToJson(this);
}
