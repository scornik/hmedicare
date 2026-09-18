// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'data.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Data _$DataFromJson(Map<String, dynamic> json) => Data(
  permissions: (json['permissions'] as List<dynamic>)
      .map((e) => e as String)
      .toList(),
  role: Role.fromJson(json['role'] as String),
  rolePermissionsVersion: (json['rolePermissionsVersion'] as num).toInt(),
  tenantId: json['tenantId'] as String,
);

Map<String, dynamic> _$DataToJson(Data instance) => <String, dynamic>{
  'permissions': instance.permissions,
  'role': instance.role,
  'rolePermissionsVersion': instance.rolePermissionsVersion,
  'tenantId': instance.tenantId,
};
