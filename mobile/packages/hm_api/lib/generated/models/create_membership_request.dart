// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'create_membership_request_role.dart';
import 'membership_permission_overrides.dart';

part 'create_membership_request.g.dart';

@JsonSerializable()
class CreateMembershipRequest {
  const CreateMembershipRequest({
    required this.displayName,
    required this.role,
    this.chamberIds,
    this.clinicIds,
    this.email,
    this.permissions,
    this.phone,
  });
  
  factory CreateMembershipRequest.fromJson(Map<String, Object?> json) => _$CreateMembershipRequestFromJson(json);
  
  final List<String>? chamberIds;
  final List<String>? clinicIds;
  final String displayName;
  final String? email;
  final MembershipPermissionOverrides? permissions;
  final String? phone;
  final CreateMembershipRequestRole role;

  Map<String, Object?> toJson() => _$CreateMembershipRequestToJson(this);
}
