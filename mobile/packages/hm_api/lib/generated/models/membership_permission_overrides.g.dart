// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'membership_permission_overrides.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MembershipPermissionOverrides _$MembershipPermissionOverridesFromJson(
  Map<String, dynamic> json,
) => MembershipPermissionOverrides(
  denials: (json['denials'] as List<dynamic>).map((e) => e as String).toList(),
  grants: (json['grants'] as List<dynamic>).map((e) => e as String).toList(),
);

Map<String, dynamic> _$MembershipPermissionOverridesToJson(
  MembershipPermissionOverrides instance,
) => <String, dynamic>{'denials': instance.denials, 'grants': instance.grants};
