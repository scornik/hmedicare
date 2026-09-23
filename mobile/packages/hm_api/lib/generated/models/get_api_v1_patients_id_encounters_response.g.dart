// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_patients_id_encounters_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1PatientsIdEncountersResponse
_$GetApiV1PatientsIdEncountersResponseFromJson(Map<String, dynamic> json) =>
    GetApiV1PatientsIdEncountersResponse(
      data: (json['data'] as List<dynamic>)
          .map((e) => EncounterSummary.fromJson(e as Map<String, dynamic>))
          .toList(),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$GetApiV1PatientsIdEncountersResponseToJson(
  GetApiV1PatientsIdEncountersResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
