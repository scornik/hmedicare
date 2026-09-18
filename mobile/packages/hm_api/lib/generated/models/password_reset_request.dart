// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'locale.dart';

part 'password_reset_request.g.dart';

@JsonSerializable()
class PasswordResetRequest {
  const PasswordResetRequest({
    required this.email,
    this.locale,
  });
  
  factory PasswordResetRequest.fromJson(Map<String, Object?> json) => _$PasswordResetRequestFromJson(json);
  
  final String email;
  final Locale? locale;

  Map<String, Object?> toJson() => _$PasswordResetRequestToJson(this);
}
