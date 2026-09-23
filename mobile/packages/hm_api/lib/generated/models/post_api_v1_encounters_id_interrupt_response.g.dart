// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_encounters_id_interrupt_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1EncountersIdInterruptResponse
_$PostApiV1EncountersIdInterruptResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1EncountersIdInterruptResponse(
      data: Encounter.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1EncountersIdInterruptResponseToJson(
  PostApiV1EncountersIdInterruptResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
