// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'serial.g.dart';

@JsonSerializable()
class Serial {
  const Serial({
    required this.id,
    required this.serialNumber,
    required this.status,
  });
  
  factory Serial.fromJson(Map<String, Object?> json) => _$SerialFromJson(json);
  
  final String id;
  final int serialNumber;
  final String status;

  Map<String, Object?> toJson() => _$SerialToJson(this);
}
