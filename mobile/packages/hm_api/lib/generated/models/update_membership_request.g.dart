// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'update_membership_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

UpdateMembershipRequest _$UpdateMembershipRequestFromJson(
  Map<String, dynamic> json,
) => UpdateMembershipRequest(
  expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
  chamberIds: (json['chamberIds'] as List<dynamic>?)
      ?.map((e) => e as String)
      .toList(),
  clinicIds: (json['clinicIds'] as List<dynamic>?)
      ?.map((e) => e as String)
      .toList(),
  permissions: json['permissions'] == null
      ? null
      : MembershipPermissionOverrides.fromJson(
          json['permissions'] as Map<String, dynamic>,
        ),
  role: json['role'] == null
      ? null
      : UpdateMembershipRequestRole.fromJson(json['role'] as String),
  status: json['status'] == null
      ? null
      : UpdateMembershipRequestStatus.fromJson(json['status'] as String),
);

Map<String, dynamic> _$UpdateMembershipRequestToJson(
  UpdateMembershipRequest instance,
) => <String, dynamic>{
  'chamberIds': ?instance.chamberIds,
  'clinicIds': ?instance.clinicIds,
  'expectedRowVersion': instance.expectedRowVersion,
  'permissions': ?instance.permissions,
  'role': ?instance.role,
  'status': ?instance.status,
};
