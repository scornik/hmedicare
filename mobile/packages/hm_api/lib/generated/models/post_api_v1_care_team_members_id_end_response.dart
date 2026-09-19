// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'care_team_member.dart';
import 'response_meta.dart';

part 'post_api_v1_care_team_members_id_end_response.g.dart';

@JsonSerializable()
class PostApiV1CareTeamMembersIdEndResponse {
  const PostApiV1CareTeamMembersIdEndResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1CareTeamMembersIdEndResponse.fromJson(Map<String, Object?> json) => _$PostApiV1CareTeamMembersIdEndResponseFromJson(json);
  
  final CareTeamMember data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1CareTeamMembersIdEndResponseToJson(this);
}
