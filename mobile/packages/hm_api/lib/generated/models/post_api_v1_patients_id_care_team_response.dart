// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'care_team_member.dart';
import 'response_meta.dart';

part 'post_api_v1_patients_id_care_team_response.g.dart';

@JsonSerializable()
class PostApiV1PatientsIdCareTeamResponse {
  const PostApiV1PatientsIdCareTeamResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1PatientsIdCareTeamResponse.fromJson(Map<String, Object?> json) => _$PostApiV1PatientsIdCareTeamResponseFromJson(json);
  
  final CareTeamMember data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1PatientsIdCareTeamResponseToJson(this);
}
