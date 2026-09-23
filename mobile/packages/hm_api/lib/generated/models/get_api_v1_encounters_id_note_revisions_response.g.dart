// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_encounters_id_note_revisions_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1EncountersIdNoteRevisionsResponse
_$GetApiV1EncountersIdNoteRevisionsResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1EncountersIdNoteRevisionsResponse(
  data: (json['data'] as List<dynamic>)
      .map((e) => EncounterNoteRevision.fromJson(e as Map<String, dynamic>))
      .toList(),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1EncountersIdNoteRevisionsResponseToJson(
  GetApiV1EncountersIdNoteRevisionsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
