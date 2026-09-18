// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'password_reset_complete.g.dart';

@JsonSerializable()
class PasswordResetComplete {
  const PasswordResetComplete({
    required this.newPassword,
    required this.token,
  });
  
  factory PasswordResetComplete.fromJson(Map<String, Object?> json) => _$PasswordResetCompleteFromJson(json);
  
  final String newPassword;
  final String token;

  Map<String, Object?> toJson() => _$PasswordResetCompleteToJson(this);
}
