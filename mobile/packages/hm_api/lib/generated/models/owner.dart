// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'owner.g.dart';

@JsonSerializable()
class Owner {
  const Owner({
    required this.displayName,
    this.email,
    this.phone,
  });
  
  factory Owner.fromJson(Map<String, Object?> json) => _$OwnerFromJson(json);
  
  final String displayName;
  final String? email;
  final String? phone;

  Map<String, Object?> toJson() => _$OwnerToJson(this);
}
