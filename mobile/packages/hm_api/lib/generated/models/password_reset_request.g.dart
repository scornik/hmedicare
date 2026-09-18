// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'password_reset_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PasswordResetRequest _$PasswordResetRequestFromJson(
  Map<String, dynamic> json,
) => PasswordResetRequest(
  email: json['email'] as String,
  locale: json['locale'] == null
      ? null
      : Locale.fromJson(json['locale'] as String),
);

Map<String, dynamic> _$PasswordResetRequestToJson(
  PasswordResetRequest instance,
) => <String, dynamic>{'email': instance.email, 'locale': instance.locale};
