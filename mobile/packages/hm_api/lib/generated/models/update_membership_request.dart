// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'membership_permission_overrides.dart';
import 'update_membership_request_role.dart';
import 'update_membership_request_status.dart';

part 'update_membership_request.g.dart';

@JsonSerializable()
class UpdateMembershipRequest {
  const UpdateMembershipRequest({
    required this.expectedRowVersion,
    this.chamberIds,
    this.clinicIds,
    this.permissions,
    this.role,
    this.status,
  });
  
  factory UpdateMembershipRequest.fromJson(Map<String, Object?> json) => _$UpdateMembershipRequestFromJson(json);
  
  final List<String>? chamberIds;
  final List<String>? clinicIds;
  final int expectedRowVersion;
  final MembershipPermissionOverrides? permissions;
  final UpdateMembershipRequestRole? role;
  final UpdateMembershipRequestStatus? status;

  Map<String, Object?> toJson() => _$UpdateMembershipRequestToJson(this);
}
