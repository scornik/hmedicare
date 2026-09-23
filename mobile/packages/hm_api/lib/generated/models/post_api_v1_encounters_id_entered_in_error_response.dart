// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'encounter.dart';
import 'response_meta.dart';

part 'post_api_v1_encounters_id_entered_in_error_response.g.dart';

@JsonSerializable()
class PostApiV1EncountersIdEnteredInErrorResponse {
  const PostApiV1EncountersIdEnteredInErrorResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1EncountersIdEnteredInErrorResponse.fromJson(Map<String, Object?> json) => _$PostApiV1EncountersIdEnteredInErrorResponseFromJson(json);
  
  final Encounter data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1EncountersIdEnteredInErrorResponseToJson(this);
}
