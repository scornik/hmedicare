// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'attested_source.dart';

part 'api_v1_lab_reports_id_review_request_body.g.dart';

@JsonSerializable()
class ApiV1LabReportsIdReviewRequestBody {
  const ApiV1LabReportsIdReviewRequestBody({
    required this.attestedSource,
    required this.expectedRowVersion,
  });
  
  factory ApiV1LabReportsIdReviewRequestBody.fromJson(Map<String, Object?> json) => _$ApiV1LabReportsIdReviewRequestBodyFromJson(json);
  
  final AttestedSource attestedSource;
  final int expectedRowVersion;

  Map<String, Object?> toJson() => _$ApiV1LabReportsIdReviewRequestBodyToJson(this);
}
