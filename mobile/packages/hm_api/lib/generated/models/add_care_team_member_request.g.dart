// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'add_care_team_member_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AddCareTeamMemberRequest _$AddCareTeamMemberRequestFromJson(
  Map<String, dynamic> json,
) => AddCareTeamMemberRequest(
  memberUserId: json['memberUserId'] as String,
  role: AddCareTeamMemberRequestRole.fromJson(json['role'] as String),
  reason: json['reason'] as String?,
  startsAt: json['startsAt'] == null
      ? null
      : DateTime.parse(json['startsAt'] as String),
);

Map<String, dynamic> _$AddCareTeamMemberRequestToJson(
  AddCareTeamMemberRequest instance,
) => <String, dynamic>{
  'memberUserId': instance.memberUserId,
  'reason': ?instance.reason,
  'role': instance.role,
  'startsAt': ?instance.startsAt?.toIso8601String(),
};
