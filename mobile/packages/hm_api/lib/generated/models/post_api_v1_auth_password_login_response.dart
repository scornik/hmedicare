// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'session_response.dart';
import 'response_meta.dart';

part 'post_api_v1_auth_password_login_response.g.dart';

@JsonSerializable()
class PostApiV1AuthPasswordLoginResponse {
  const PostApiV1AuthPasswordLoginResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1AuthPasswordLoginResponse.fromJson(Map<String, Object?> json) => _$PostApiV1AuthPasswordLoginResponseFromJson(json);
  
  final SessionResponse data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1AuthPasswordLoginResponseToJson(this);
}
