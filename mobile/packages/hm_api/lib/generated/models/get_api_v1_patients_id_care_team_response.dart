// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'care_team_member.dart';
import 'response_meta.dart';

part 'get_api_v1_patients_id_care_team_response.g.dart';

@JsonSerializable()
class GetApiV1PatientsIdCareTeamResponse {
  const GetApiV1PatientsIdCareTeamResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1PatientsIdCareTeamResponse.fromJson(Map<String, Object?> json) => _$GetApiV1PatientsIdCareTeamResponseFromJson(json);
  
  final List<CareTeamMember> data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1PatientsIdCareTeamResponseToJson(this);
}
