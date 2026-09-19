// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'duplicate_review.g.dart';

/// Staff confirmation that the listed candidates are different people (audited)
@JsonSerializable()
class DuplicateReview {
  const DuplicateReview({
    required this.acknowledgedCandidateIds,
    required this.reason,
  });
  
  factory DuplicateReview.fromJson(Map<String, Object?> json) => _$DuplicateReviewFromJson(json);
  
  final List<String> acknowledgedCandidateIds;
  final String reason;

  Map<String, Object?> toJson() => _$DuplicateReviewToJson(this);
}
