// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'duplicate_review.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DuplicateReview _$DuplicateReviewFromJson(Map<String, dynamic> json) =>
    DuplicateReview(
      acknowledgedCandidateIds:
          (json['acknowledgedCandidateIds'] as List<dynamic>)
              .map((e) => e as String)
              .toList(),
      reason: json['reason'] as String,
    );

Map<String, dynamic> _$DuplicateReviewToJson(DuplicateReview instance) =>
    <String, dynamic>{
      'acknowledgedCandidateIds': instance.acknowledgedCandidateIds,
      'reason': instance.reason,
    };
