// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'encounter.dart';
import 'response_meta.dart';

part 'post_api_v1_encounters_id_complete_response.g.dart';

@JsonSerializable()
class PostApiV1EncountersIdCompleteResponse {
  const PostApiV1EncountersIdCompleteResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1EncountersIdCompleteResponse.fromJson(Map<String, Object?> json) => _$PostApiV1EncountersIdCompleteResponseFromJson(json);
  
  final Encounter data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1EncountersIdCompleteResponseToJson(this);
}
