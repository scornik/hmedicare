// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_encounters_id_telemedicine_session_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1EncountersIdTelemedicineSessionResponse
_$PostApiV1EncountersIdTelemedicineSessionResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1EncountersIdTelemedicineSessionResponse(
  data: TelemedicineSession.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1EncountersIdTelemedicineSessionResponseToJson(
  PostApiV1EncountersIdTelemedicineSessionResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
