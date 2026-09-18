// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'response_meta.dart';

part 'delete_api_v1_me_sessions_id_response.g.dart';

@JsonSerializable()
class DeleteApiV1MeSessionsIdResponse {
  const DeleteApiV1MeSessionsIdResponse({
    required this.data,
    required this.meta,
  });
  
  factory DeleteApiV1MeSessionsIdResponse.fromJson(Map<String, Object?> json) => _$DeleteApiV1MeSessionsIdResponseFromJson(json);
  
  final dynamic data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$DeleteApiV1MeSessionsIdResponseToJson(this);
}
