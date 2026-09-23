// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'encounter.dart';
import 'response_meta.dart';

part 'post_api_v1_serials_id_encounter_response.g.dart';

@JsonSerializable()
class PostApiV1SerialsIdEncounterResponse {
  const PostApiV1SerialsIdEncounterResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1SerialsIdEncounterResponse.fromJson(Map<String, Object?> json) => _$PostApiV1SerialsIdEncounterResponseFromJson(json);
  
  final Encounter data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1SerialsIdEncounterResponseToJson(this);
}
