// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'download_token_response.g.dart';

@JsonSerializable()
class DownloadTokenResponse {
  const DownloadTokenResponse({
    required this.expiresAt,
    required this.revision,
    required this.token,
  });
  
  factory DownloadTokenResponse.fromJson(Map<String, Object?> json) => _$DownloadTokenResponseFromJson(json);
  
  final DateTime expiresAt;

  /// The revision this token serves; a later revision needs a new token
  final int revision;

  /// Single use, short lived, bound to this actor and revision
  final String token;

  Map<String, Object?> toJson() => _$DownloadTokenResponseToJson(this);
}
