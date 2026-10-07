// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'download_token_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DownloadTokenResponse _$DownloadTokenResponseFromJson(
  Map<String, dynamic> json,
) => DownloadTokenResponse(
  expiresAt: DateTime.parse(json['expiresAt'] as String),
  revision: (json['revision'] as num).toInt(),
  token: json['token'] as String,
);

Map<String, dynamic> _$DownloadTokenResponseToJson(
  DownloadTokenResponse instance,
) => <String, dynamic>{
  'expiresAt': instance.expiresAt.toIso8601String(),
  'revision': instance.revision,
  'token': instance.token,
};
