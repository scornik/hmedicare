// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'data6.g.dart';

@JsonSerializable()
class Data6 {
  const Data6({
    required this.partNumber,
    required this.sha256,
    required this.sizeBytes,
  });
  
  factory Data6.fromJson(Map<String, Object?> json) => _$Data6FromJson(json);
  
  final int partNumber;
  final String sha256;
  final int sizeBytes;

  Map<String, Object?> toJson() => _$Data6ToJson(this);
}
