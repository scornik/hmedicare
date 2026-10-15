// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'source_refs.g.dart';

@JsonSerializable()
class SourceRefs {
  const SourceRefs({
    required this.occurredAt,
    required this.sourceId,
    required this.sourceType,
  });
  
  factory SourceRefs.fromJson(Map<String, Object?> json) => _$SourceRefsFromJson(json);
  
  final DateTime occurredAt;
  final String sourceId;
  final String sourceType;

  Map<String, Object?> toJson() => _$SourceRefsToJson(this);
}
