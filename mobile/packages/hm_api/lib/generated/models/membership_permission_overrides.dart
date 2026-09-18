// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'membership_permission_overrides.g.dart';

@JsonSerializable()
class MembershipPermissionOverrides {
  const MembershipPermissionOverrides({
    required this.denials,
    required this.grants,
  });
  
  factory MembershipPermissionOverrides.fromJson(Map<String, Object?> json) => _$MembershipPermissionOverridesFromJson(json);
  
  final List<String> denials;
  final List<String> grants;

  Map<String, Object?> toJson() => _$MembershipPermissionOverridesToJson(this);
}
