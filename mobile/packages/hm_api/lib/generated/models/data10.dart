// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'role.dart';

part 'data10.g.dart';

@JsonSerializable()
class Data10 {
  const Data10({
    required this.permissions,
    required this.role,
    required this.rolePermissionsVersion,
    required this.tenantId,
  });
  
  factory Data10.fromJson(Map<String, Object?> json) => _$Data10FromJson(json);
  
  final List<String> permissions;
  final Role role;
  final int rolePermissionsVersion;
  final String tenantId;

  Map<String, Object?> toJson() => _$Data10ToJson(this);
}
