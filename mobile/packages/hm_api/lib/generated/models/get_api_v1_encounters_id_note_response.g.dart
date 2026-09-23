// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_encounters_id_note_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1EncountersIdNoteResponse _$GetApiV1EncountersIdNoteResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1EncountersIdNoteResponse(
  data: EncounterNoteDraft.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1EncountersIdNoteResponseToJson(
  GetApiV1EncountersIdNoteResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
