// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'data4.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Data4 _$Data4FromJson(Map<String, dynamic> json) => Data4(
  balance: json['balance'] == null
      ? null
      : SmsBalanceView.fromJson(json['balance'] as Map<String, dynamic>),
  credential: SmsCredentialView.fromJson(
    json['credential'] as Map<String, dynamic>,
  ),
);

Map<String, dynamic> _$Data4ToJson(Data4 instance) => <String, dynamic>{
  'balance': ?instance.balance,
  'credential': instance.credential,
};
