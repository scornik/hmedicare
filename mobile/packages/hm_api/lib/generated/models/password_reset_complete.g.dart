// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'password_reset_complete.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PasswordResetComplete _$PasswordResetCompleteFromJson(
  Map<String, dynamic> json,
) => PasswordResetComplete(
  newPassword: json['newPassword'] as String,
  token: json['token'] as String,
);

Map<String, dynamic> _$PasswordResetCompleteToJson(
  PasswordResetComplete instance,
) => <String, dynamic>{
  'newPassword': instance.newPassword,
  'token': instance.token,
};
