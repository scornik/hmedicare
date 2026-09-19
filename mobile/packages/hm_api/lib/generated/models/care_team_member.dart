// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'care_team_member_role.dart';

part 'care_team_member.g.dart';

@JsonSerializable()
class CareTeamMember {
  const CareTeamMember({
    required this.endsAt,
    required this.id,
    required this.memberUserId,
    required this.patientId,
    required this.reason,
    required this.role,
    required this.rowVersion,
    required this.startsAt,
  });
  
  factory CareTeamMember.fromJson(Map<String, Object?> json) => _$CareTeamMemberFromJson(json);
  
  final DateTime? endsAt;
  final String id;
  final String memberUserId;
  final String patientId;
  final String? reason;
  final CareTeamMemberRole role;
  final int rowVersion;
  final DateTime startsAt;

  Map<String, Object?> toJson() => _$CareTeamMemberToJson(this);
}
