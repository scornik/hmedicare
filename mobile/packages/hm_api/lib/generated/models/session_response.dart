// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'me_user.dart';

part 'session_response.g.dart';

@JsonSerializable()
class SessionResponse {
  const SessionResponse({
    required this.accessToken,
    required this.accessTokenExpiresAt,
    required this.user,
    this.csrfToken,
    this.refreshToken,
    this.refreshTokenExpiresAt,
  });
  
  factory SessionResponse.fromJson(Map<String, Object?> json) => _$SessionResponseFromJson(json);
  
  final String accessToken;
  final DateTime accessTokenExpiresAt;

  /// Web only; echo in X-CSRF-Token
  final String? csrfToken;

  /// Mobile only (secure storage)
  final String? refreshToken;
  final DateTime? refreshTokenExpiresAt;
  final MeUser user;

  Map<String, Object?> toJson() => _$SessionResponseToJson(this);
}
