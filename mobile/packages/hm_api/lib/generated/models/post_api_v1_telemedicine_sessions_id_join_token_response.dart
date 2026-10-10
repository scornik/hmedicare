// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'telemedicine_join_token.dart';
import 'response_meta.dart';

part 'post_api_v1_telemedicine_sessions_id_join_token_response.g.dart';

@JsonSerializable()
class PostApiV1TelemedicineSessionsIdJoinTokenResponse {
  const PostApiV1TelemedicineSessionsIdJoinTokenResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1TelemedicineSessionsIdJoinTokenResponse.fromJson(Map<String, Object?> json) => _$PostApiV1TelemedicineSessionsIdJoinTokenResponseFromJson(json);
  
  final TelemedicineJoinToken data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1TelemedicineSessionsIdJoinTokenResponseToJson(this);
}
