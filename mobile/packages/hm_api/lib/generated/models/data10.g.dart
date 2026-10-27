// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'data10.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Data10 _$Data10FromJson(Map<String, dynamic> json) => Data10(
  permissions: (json['permissions'] as List<dynamic>)
      .map((e) => e as String)
      .toList(),
  role: Role.fromJson(json['role'] as String),
  rolePermissionsVersion: (json['rolePermissionsVersion'] as num).toInt(),
  tenantId: json['tenantId'] as String,
);

Map<String, dynamic> _$Data10ToJson(Data10 instance) => <String, dynamic>{
  'permissions': instance.permissions,
  'role': instance.role,
  'rolePermissionsVersion': instance.rolePermissionsVersion,
  'tenantId': instance.tenantId,
};
