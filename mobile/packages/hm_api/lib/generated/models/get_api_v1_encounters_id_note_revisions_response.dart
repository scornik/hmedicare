// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'encounter_note_revision.dart';
import 'response_meta.dart';

part 'get_api_v1_encounters_id_note_revisions_response.g.dart';

@JsonSerializable()
class GetApiV1EncountersIdNoteRevisionsResponse {
  const GetApiV1EncountersIdNoteRevisionsResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1EncountersIdNoteRevisionsResponse.fromJson(Map<String, Object?> json) => _$GetApiV1EncountersIdNoteRevisionsResponseFromJson(json);
  
  final List<EncounterNoteRevision> data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1EncountersIdNoteRevisionsResponseToJson(this);
}
