// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'source.g.dart';

@JsonSerializable()
class Source {
  const Source({
    required this.datasetVersion,
    required this.dgdaMatch,
    required this.isSynthetic,
    required this.reviewStatus,
  });
  
  factory Source.fromJson(Map<String, Object?> json) => _$SourceFromJson(json);
  
  final String datasetVersion;
  final String dgdaMatch;
  final bool isSynthetic;

  /// UNVERIFIED for the current catalog; shown as a badge
  final String reviewStatus;

  Map<String, Object?> toJson() => _$SourceToJson(this);
}
