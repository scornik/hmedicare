// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'encounter.dart';
import 'response_meta.dart';

part 'post_api_v1_encounters_id_interrupt_response.g.dart';

@JsonSerializable()
class PostApiV1EncountersIdInterruptResponse {
  const PostApiV1EncountersIdInterruptResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1EncountersIdInterruptResponse.fromJson(Map<String, Object?> json) => _$PostApiV1EncountersIdInterruptResponseFromJson(json);
  
  final Encounter data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1EncountersIdInterruptResponseToJson(this);
}
