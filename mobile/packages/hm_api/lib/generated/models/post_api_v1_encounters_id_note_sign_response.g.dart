// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_encounters_id_note_sign_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1EncountersIdNoteSignResponse
_$PostApiV1EncountersIdNoteSignResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1EncountersIdNoteSignResponse(
      data: EncounterNoteRevision.fromJson(
        json['data'] as Map<String, dynamic>,
      ),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1EncountersIdNoteSignResponseToJson(
  PostApiV1EncountersIdNoteSignResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
