// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'sms_balance_view.dart';
import 'sms_credential_view.dart';

part 'data12.g.dart';

@JsonSerializable()
class Data12 {
  const Data12({
    required this.balance,
    required this.credential,
  });
  
  factory Data12.fromJson(Map<String, Object?> json) => _$Data12FromJson(json);
  
  final SmsBalanceView? balance;
  final SmsCredentialView credential;

  Map<String, Object?> toJson() => _$Data12ToJson(this);
}
