// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'sms_balance_view.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SmsBalanceView _$SmsBalanceViewFromJson(Map<String, dynamic> json) =>
    SmsBalanceView(
      balance: json['balance'] as String?,
      checkedAt: DateTime.parse(json['checkedAt'] as String),
      currencyText: json['currencyText'] as String?,
      errorClass: json['errorClass'] as String?,
      parseStatus: SmsBalanceParseStatus.fromJson(
        json['parseStatus'] as String,
      ),
    );

Map<String, dynamic> _$SmsBalanceViewToJson(SmsBalanceView instance) =>
    <String, dynamic>{
      'balance': ?instance.balance,
      'checkedAt': instance.checkedAt.toIso8601String(),
      'currencyText': ?instance.currencyText,
      'errorClass': ?instance.errorClass,
      'parseStatus': instance.parseStatus,
    };
