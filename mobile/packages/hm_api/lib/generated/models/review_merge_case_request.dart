// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'review_merge_case_request.g.dart';

@JsonSerializable()
class ReviewMergeCaseRequest {
  const ReviewMergeCaseRequest({
    required this.expectedRowVersion,
    this.reason,
  });
  
  factory ReviewMergeCaseRequest.fromJson(Map<String, Object?> json) => _$ReviewMergeCaseRequestFromJson(json);
  
  final int expectedRowVersion;
  final String? reason;

  Map<String, Object?> toJson() => _$ReviewMergeCaseRequestToJson(this);
}
