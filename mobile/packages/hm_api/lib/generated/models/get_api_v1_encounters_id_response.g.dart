// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_encounters_id_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1EncountersIdResponse _$GetApiV1EncountersIdResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1EncountersIdResponse(
  data: Encounter.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1EncountersIdResponseToJson(
  GetApiV1EncountersIdResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
