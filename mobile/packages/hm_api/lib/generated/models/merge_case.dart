// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'merge_case_status.dart';

part 'merge_case.g.dart';

@JsonSerializable()
class MergeCase {
  const MergeCase({
    required this.createdAt,
    required this.duplicateScore,
    required this.id,
    required this.reason,
    required this.requestedByUserId,
    required this.reviewedAt,
    required this.reviewedByUserId,
    required this.rowVersion,
    required this.sourcePatientId,
    required this.status,
    required this.targetPatientId,
  });
  
  factory MergeCase.fromJson(Map<String, Object?> json) => _$MergeCaseFromJson(json);
  
  final DateTime createdAt;
  final num? duplicateScore;
  final String id;
  final String reason;
  final String requestedByUserId;
  final DateTime? reviewedAt;
  final String? reviewedByUserId;
  final int rowVersion;
  final String sourcePatientId;
  final MergeCaseStatus status;
  final String targetPatientId;

  Map<String, Object?> toJson() => _$MergeCaseToJson(this);
}
