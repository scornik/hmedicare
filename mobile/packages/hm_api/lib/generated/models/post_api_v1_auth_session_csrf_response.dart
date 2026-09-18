// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'csrf_response.dart';
import 'response_meta.dart';

part 'post_api_v1_auth_session_csrf_response.g.dart';

@JsonSerializable()
class PostApiV1AuthSessionCsrfResponse {
  const PostApiV1AuthSessionCsrfResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1AuthSessionCsrfResponse.fromJson(Map<String, Object?> json) => _$PostApiV1AuthSessionCsrfResponseFromJson(json);
  
  final CsrfResponse data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1AuthSessionCsrfResponseToJson(this);
}
