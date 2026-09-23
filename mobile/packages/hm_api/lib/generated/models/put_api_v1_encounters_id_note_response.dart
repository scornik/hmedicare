// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'encounter_note_draft.dart';
import 'response_meta.dart';

part 'put_api_v1_encounters_id_note_response.g.dart';

@JsonSerializable()
class PutApiV1EncountersIdNoteResponse {
  const PutApiV1EncountersIdNoteResponse({
    required this.data,
    required this.meta,
  });
  
  factory PutApiV1EncountersIdNoteResponse.fromJson(Map<String, Object?> json) => _$PutApiV1EncountersIdNoteResponseFromJson(json);
  
  final EncounterNoteDraft data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PutApiV1EncountersIdNoteResponseToJson(this);
}
