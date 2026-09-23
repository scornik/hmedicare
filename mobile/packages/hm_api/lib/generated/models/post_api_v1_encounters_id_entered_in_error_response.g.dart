// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_encounters_id_entered_in_error_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1EncountersIdEnteredInErrorResponse
_$PostApiV1EncountersIdEnteredInErrorResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1EncountersIdEnteredInErrorResponse(
  data: Encounter.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1EncountersIdEnteredInErrorResponseToJson(
  PostApiV1EncountersIdEnteredInErrorResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
