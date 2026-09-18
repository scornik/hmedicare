// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'session_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SessionResponse _$SessionResponseFromJson(Map<String, dynamic> json) =>
    SessionResponse(
      accessToken: json['accessToken'] as String,
      accessTokenExpiresAt: DateTime.parse(
        json['accessTokenExpiresAt'] as String,
      ),
      user: MeUser.fromJson(json['user'] as Map<String, dynamic>),
      csrfToken: json['csrfToken'] as String?,
      refreshToken: json['refreshToken'] as String?,
      refreshTokenExpiresAt: json['refreshTokenExpiresAt'] == null
          ? null
          : DateTime.parse(json['refreshTokenExpiresAt'] as String),
    );

Map<String, dynamic> _$SessionResponseToJson(
  SessionResponse instance,
) => <String, dynamic>{
  'accessToken': instance.accessToken,
  'accessTokenExpiresAt': instance.accessTokenExpiresAt.toIso8601String(),
  'csrfToken': instance.csrfToken,
  'refreshToken': instance.refreshToken,
  'refreshTokenExpiresAt': instance.refreshTokenExpiresAt?.toIso8601String(),
  'user': instance.user,
};
