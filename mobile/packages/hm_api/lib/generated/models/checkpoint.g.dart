// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'checkpoint.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Checkpoint _$CheckpointFromJson(Map<String, dynamic> json) => Checkpoint(
  file: json['file'] as String,
  line: (json['line'] as num).toInt(),
);

Map<String, dynamic> _$CheckpointToJson(Checkpoint instance) =>
    <String, dynamic>{'file': instance.file, 'line': instance.line};
