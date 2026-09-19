// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_patients_id_care_team_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1PatientsIdCareTeamResponse
_$PostApiV1PatientsIdCareTeamResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1PatientsIdCareTeamResponse(
      data: CareTeamMember.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1PatientsIdCareTeamResponseToJson(
  PostApiV1PatientsIdCareTeamResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
