// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'checkpoint.g.dart';

@JsonSerializable()
class Checkpoint {
  const Checkpoint({
    required this.file,
    required this.line,
  });
  
  factory Checkpoint.fromJson(Map<String, Object?> json) => _$CheckpointFromJson(json);
  
  final String file;
  final int line;

  Map<String, Object?> toJson() => _$CheckpointToJson(this);
}
