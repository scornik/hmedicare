// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'encounter_note_revision.dart';
import 'response_meta.dart';

part 'post_api_v1_encounters_id_note_corrections_response.g.dart';

@JsonSerializable()
class PostApiV1EncountersIdNoteCorrectionsResponse {
  const PostApiV1EncountersIdNoteCorrectionsResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1EncountersIdNoteCorrectionsResponse.fromJson(Map<String, Object?> json) => _$PostApiV1EncountersIdNoteCorrectionsResponseFromJson(json);
  
  final EncounterNoteRevision data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1EncountersIdNoteCorrectionsResponseToJson(this);
}
