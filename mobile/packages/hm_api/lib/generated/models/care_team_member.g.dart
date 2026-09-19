// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'care_team_member.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CareTeamMember _$CareTeamMemberFromJson(Map<String, dynamic> json) =>
    CareTeamMember(
      endsAt: json['endsAt'] == null
          ? null
          : DateTime.parse(json['endsAt'] as String),
      id: json['id'] as String,
      memberUserId: json['memberUserId'] as String,
      patientId: json['patientId'] as String,
      reason: json['reason'] as String?,
      role: CareTeamMemberRole.fromJson(json['role'] as String),
      rowVersion: (json['rowVersion'] as num).toInt(),
      startsAt: DateTime.parse(json['startsAt'] as String),
    );

Map<String, dynamic> _$CareTeamMemberToJson(CareTeamMember instance) =>
    <String, dynamic>{
      'endsAt': ?instance.endsAt?.toIso8601String(),
      'id': instance.id,
      'memberUserId': instance.memberUserId,
      'patientId': instance.patientId,
      'reason': ?instance.reason,
      'role': instance.role,
      'rowVersion': instance.rowVersion,
      'startsAt': instance.startsAt.toIso8601String(),
    };
