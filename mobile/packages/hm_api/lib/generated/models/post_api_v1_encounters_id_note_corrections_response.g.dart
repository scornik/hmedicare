// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_encounters_id_note_corrections_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1EncountersIdNoteCorrectionsResponse
_$PostApiV1EncountersIdNoteCorrectionsResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1EncountersIdNoteCorrectionsResponse(
  data: EncounterNoteRevision.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1EncountersIdNoteCorrectionsResponseToJson(
  PostApiV1EncountersIdNoteCorrectionsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
