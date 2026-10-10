// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'data2.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Data2 _$Data2FromJson(Map<String, dynamic> json) => Data2(
  permissions: (json['permissions'] as List<dynamic>)
      .map((e) => e as String)
      .toList(),
  role: Role.fromJson(json['role'] as String),
  rolePermissionsVersion: (json['rolePermissionsVersion'] as num).toInt(),
  tenantId: json['tenantId'] as String,
);

Map<String, dynamic> _$Data2ToJson(Data2 instance) => <String, dynamic>{
  'permissions': instance.permissions,
  'role': instance.role,
  'rolePermissionsVersion': instance.rolePermissionsVersion,
  'tenantId': instance.tenantId,
};
