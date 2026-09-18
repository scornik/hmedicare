// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'response_meta.dart';

part 'post_api_v1_auth_session_logout_all_response.g.dart';

@JsonSerializable()
class PostApiV1AuthSessionLogoutAllResponse {
  const PostApiV1AuthSessionLogoutAllResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1AuthSessionLogoutAllResponse.fromJson(Map<String, Object?> json) => _$PostApiV1AuthSessionLogoutAllResponseFromJson(json);
  
  final dynamic data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1AuthSessionLogoutAllResponseToJson(this);
}
