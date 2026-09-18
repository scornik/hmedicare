// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'response_meta.dart';

part 'post_api_v1_auth_password_reset_request_response.g.dart';

@JsonSerializable()
class PostApiV1AuthPasswordResetRequestResponse {
  const PostApiV1AuthPasswordResetRequestResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1AuthPasswordResetRequestResponse.fromJson(Map<String, Object?> json) => _$PostApiV1AuthPasswordResetRequestResponseFromJson(json);
  
  final dynamic data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1AuthPasswordResetRequestResponseToJson(this);
}
