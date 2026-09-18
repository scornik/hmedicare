// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'session_summary.dart';
import 'response_meta.dart';

part 'get_api_v1_me_sessions_response.g.dart';

@JsonSerializable()
class GetApiV1MeSessionsResponse {
  const GetApiV1MeSessionsResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1MeSessionsResponse.fromJson(Map<String, Object?> json) => _$GetApiV1MeSessionsResponseFromJson(json);
  
  final List<SessionSummary> data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1MeSessionsResponseToJson(this);
}
