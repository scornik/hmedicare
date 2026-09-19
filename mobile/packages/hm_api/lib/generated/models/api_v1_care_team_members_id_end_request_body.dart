// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'api_v1_care_team_members_id_end_request_body.g.dart';

@JsonSerializable()
class ApiV1CareTeamMembersIdEndRequestBody {
  const ApiV1CareTeamMembersIdEndRequestBody({
    required this.expectedRowVersion,
  });
  
  factory ApiV1CareTeamMembersIdEndRequestBody.fromJson(Map<String, Object?> json) => _$ApiV1CareTeamMembersIdEndRequestBodyFromJson(json);
  
  final int expectedRowVersion;

  Map<String, Object?> toJson() => _$ApiV1CareTeamMembersIdEndRequestBodyToJson(this);
}
