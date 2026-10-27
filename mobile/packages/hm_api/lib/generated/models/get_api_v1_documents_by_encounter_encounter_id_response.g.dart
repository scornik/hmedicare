// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_documents_by_encounter_encounter_id_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1DocumentsByEncounterEncounterIdResponse
_$GetApiV1DocumentsByEncounterEncounterIdResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1DocumentsByEncounterEncounterIdResponse(
  data: EncounterDocumentList.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1DocumentsByEncounterEncounterIdResponseToJson(
  GetApiV1DocumentsByEncounterEncounterIdResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
