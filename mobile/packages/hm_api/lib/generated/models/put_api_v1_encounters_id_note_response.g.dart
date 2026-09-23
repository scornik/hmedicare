// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'put_api_v1_encounters_id_note_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PutApiV1EncountersIdNoteResponse _$PutApiV1EncountersIdNoteResponseFromJson(
  Map<String, dynamic> json,
) => PutApiV1EncountersIdNoteResponse(
  data: EncounterNoteDraft.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PutApiV1EncountersIdNoteResponseToJson(
  PutApiV1EncountersIdNoteResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
