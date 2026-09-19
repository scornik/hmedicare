// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'membership.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Membership _$MembershipFromJson(Map<String, dynamic> json) => Membership(
  chamberIds: (json['chamberIds'] as List<dynamic>)
      .map((e) => e as String)
      .toList(),
  clinicIds: (json['clinicIds'] as List<dynamic>)
      .map((e) => e as String)
      .toList(),
  displayName: json['displayName'] as String?,
  email: json['email'] as String?,
  id: json['id'] as String,
  permissions: MembershipPermissionOverrides.fromJson(
    json['permissions'] as Map<String, dynamic>,
  ),
  role: MembershipRole.fromJson(json['role'] as String),
  rowVersion: (json['rowVersion'] as num).toInt(),
  status: MembershipStatus.fromJson(json['status'] as String),
  userId: json['userId'] as String,
);

Map<String, dynamic> _$MembershipToJson(Membership instance) =>
    <String, dynamic>{
      'chamberIds': instance.chamberIds,
      'clinicIds': instance.clinicIds,
      'displayName': ?instance.displayName,
      'email': ?instance.email,
      'id': instance.id,
      'permissions': instance.permissions,
      'role': instance.role,
      'rowVersion': instance.rowVersion,
      'status': instance.status,
      'userId': instance.userId,
    };
