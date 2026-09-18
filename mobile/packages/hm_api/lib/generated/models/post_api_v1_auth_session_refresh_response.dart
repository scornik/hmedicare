// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'session_response.dart';
import 'response_meta.dart';

part 'post_api_v1_auth_session_refresh_response.g.dart';

@JsonSerializable()
class PostApiV1AuthSessionRefreshResponse {
  const PostApiV1AuthSessionRefreshResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1AuthSessionRefreshResponse.fromJson(Map<String, Object?> json) => _$PostApiV1AuthSessionRefreshResponseFromJson(json);
  
  final SessionResponse data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1AuthSessionRefreshResponseToJson(this);
}
