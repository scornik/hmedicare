// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'review_status.dart';

part 'data9.g.dart';

@JsonSerializable()
class Data9 {
  const Data9({
    required this.id,
    required this.reportId,
    required this.reviewStatus,
  });
  
  factory Data9.fromJson(Map<String, Object?> json) => _$Data9FromJson(json);
  
  final String id;
  final String reportId;
  final ReviewStatus reviewStatus;

  Map<String, Object?> toJson() => _$Data9ToJson(this);
}
