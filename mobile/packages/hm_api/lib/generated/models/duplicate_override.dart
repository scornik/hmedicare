// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'duplicate_override.g.dart';

@JsonSerializable()
class DuplicateOverride {
  const DuplicateOverride({
    required this.reason,
  });
  
  factory DuplicateOverride.fromJson(Map<String, Object?> json) => _$DuplicateOverrideFromJson(json);
  
  final String reason;

  Map<String, Object?> toJson() => _$DuplicateOverrideToJson(this);
}
