// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'response_meta.dart';

part 'delete_api_v1_auth_session_response.g.dart';

@JsonSerializable()
class DeleteApiV1AuthSessionResponse {
  const DeleteApiV1AuthSessionResponse({
    required this.data,
    required this.meta,
  });
  
  factory DeleteApiV1AuthSessionResponse.fromJson(Map<String, Object?> json) => _$DeleteApiV1AuthSessionResponseFromJson(json);
  
  final dynamic data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$DeleteApiV1AuthSessionResponseToJson(this);
}
