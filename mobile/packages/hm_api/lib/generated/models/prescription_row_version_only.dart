// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'prescription_row_version_only.g.dart';

@JsonSerializable()
class PrescriptionRowVersionOnly {
  const PrescriptionRowVersionOnly({
    required this.expectedRowVersion,
  });
  
  factory PrescriptionRowVersionOnly.fromJson(Map<String, Object?> json) => _$PrescriptionRowVersionOnlyFromJson(json);
  
  final int expectedRowVersion;

  Map<String, Object?> toJson() => _$PrescriptionRowVersionOnlyToJson(this);
}
