// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'client_kind.dart';

part 'password_login_request.g.dart';

@JsonSerializable()
class PasswordLoginRequest {
  const PasswordLoginRequest({
    required this.email,
    required this.password,
    this.client,
    this.deviceLabel,
  });
  
  factory PasswordLoginRequest.fromJson(Map<String, Object?> json) => _$PasswordLoginRequestFromJson(json);
  
  final ClientKind? client;
  final String? deviceLabel;
  final String email;
  final String password;

  Map<String, Object?> toJson() => _$PasswordLoginRequestToJson(this);
}
