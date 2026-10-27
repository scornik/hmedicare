// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'data12.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Data12 _$Data12FromJson(Map<String, dynamic> json) => Data12(
  balance: json['balance'] == null
      ? null
      : SmsBalanceView.fromJson(json['balance'] as Map<String, dynamic>),
  credential: SmsCredentialView.fromJson(
    json['credential'] as Map<String, dynamic>,
  ),
);

Map<String, dynamic> _$Data12ToJson(Data12 instance) => <String, dynamic>{
  'balance': ?instance.balance,
  'credential': instance.credential,
};
