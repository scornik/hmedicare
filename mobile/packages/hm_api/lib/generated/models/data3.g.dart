// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'data3.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Data3 _$Data3FromJson(Map<String, dynamic> json) => Data3(
  balance: json['balance'] == null
      ? null
      : SmsBalanceView.fromJson(json['balance'] as Map<String, dynamic>),
  credential: SmsCredentialView.fromJson(
    json['credential'] as Map<String, dynamic>,
  ),
);

Map<String, dynamic> _$Data3ToJson(Data3 instance) => <String, dynamic>{
  'balance': ?instance.balance,
  'credential': instance.credential,
};
