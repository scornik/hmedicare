// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'source2.g.dart';

@JsonSerializable()
class Source2 {
  const Source2({
    required this.aggregateId,
    required this.encounterId,
    required this.id,
    required this.type,
  });
  
  factory Source2.fromJson(Map<String, Object?> json) => _$Source2FromJson(json);
  
  final String aggregateId;
  final String? encounterId;
  final String id;
  final String type;

  Map<String, Object?> toJson() => _$Source2ToJson(this);
}
