// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'password_login_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PasswordLoginRequest _$PasswordLoginRequestFromJson(
  Map<String, dynamic> json,
) => PasswordLoginRequest(
  email: json['email'] as String,
  password: json['password'] as String,
  client: json['client'] == null
      ? null
      : ClientKind.fromJson(json['client'] as String),
  deviceLabel: json['deviceLabel'] as String?,
);

Map<String, dynamic> _$PasswordLoginRequestToJson(
  PasswordLoginRequest instance,
) => <String, dynamic>{
  'client': ?instance.client,
  'deviceLabel': ?instance.deviceLabel,
  'email': instance.email,
  'password': instance.password,
};
