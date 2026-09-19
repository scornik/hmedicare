// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'add_care_team_member_request_role.dart';

part 'add_care_team_member_request.g.dart';

@JsonSerializable()
class AddCareTeamMemberRequest {
  const AddCareTeamMemberRequest({
    required this.memberUserId,
    required this.role,
    this.reason,
    this.startsAt,
  });
  
  factory AddCareTeamMemberRequest.fromJson(Map<String, Object?> json) => _$AddCareTeamMemberRequestFromJson(json);
  
  final String memberUserId;
  final String? reason;
  final AddCareTeamMemberRequestRole role;
  final DateTime? startsAt;

  Map<String, Object?> toJson() => _$AddCareTeamMemberRequestToJson(this);
}
