// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'membership_permission_overrides.dart';
import 'membership_role.dart';
import 'membership_status.dart';

part 'membership.g.dart';

@JsonSerializable()
class Membership {
  const Membership({
    required this.chamberIds,
    required this.clinicIds,
    required this.displayName,
    required this.doctorProfileId,
    required this.email,
    required this.id,
    required this.permissions,
    required this.role,
    required this.rowVersion,
    required this.status,
    required this.userId,
  });
  
  factory Membership.fromJson(Map<String, Object?> json) => _$MembershipFromJson(json);
  
  final List<String> chamberIds;
  final List<String> clinicIds;
  final String? displayName;

  /// The member's active doctor profile, or null for anyone who is not a doctor. Creating a chamber asks for a profile rather than a user, so this is what a doctor picker binds to (C-56)
  final String? doctorProfileId;
  final String? email;
  final String id;
  final MembershipPermissionOverrides permissions;
  final MembershipRole role;
  final int rowVersion;
  final MembershipStatus status;
  final String userId;

  Map<String, Object?> toJson() => _$MembershipToJson(this);
}
