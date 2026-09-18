// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'create_membership_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CreateMembershipRequest _$CreateMembershipRequestFromJson(
  Map<String, dynamic> json,
) => CreateMembershipRequest(
  displayName: json['displayName'] as String,
  role: CreateMembershipRequestRole.fromJson(json['role'] as String),
  chamberIds: (json['chamberIds'] as List<dynamic>?)
      ?.map((e) => e as String)
      .toList(),
  clinicIds: (json['clinicIds'] as List<dynamic>?)
      ?.map((e) => e as String)
      .toList(),
  email: json['email'] as String?,
  permissions: json['permissions'] == null
      ? null
      : MembershipPermissionOverrides.fromJson(
          json['permissions'] as Map<String, dynamic>,
        ),
  phone: json['phone'] as String?,
);

Map<String, dynamic> _$CreateMembershipRequestToJson(
  CreateMembershipRequest instance,
) => <String, dynamic>{
  'chamberIds': instance.chamberIds,
  'clinicIds': instance.clinicIds,
  'displayName': instance.displayName,
  'email': instance.email,
  'permissions': instance.permissions,
  'phone': instance.phone,
  'role': instance.role,
};
