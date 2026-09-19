// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_patients_id_care_team_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1PatientsIdCareTeamResponse _$GetApiV1PatientsIdCareTeamResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1PatientsIdCareTeamResponse(
  data: (json['data'] as List<dynamic>)
      .map((e) => CareTeamMember.fromJson(e as Map<String, dynamic>))
      .toList(),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1PatientsIdCareTeamResponseToJson(
  GetApiV1PatientsIdCareTeamResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
