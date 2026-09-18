// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'doctor_coverage.dart';
import 'response_meta.dart';

part 'post_api_v1_doctor_coverages_response.g.dart';

@JsonSerializable()
class PostApiV1DoctorCoveragesResponse {
  const PostApiV1DoctorCoveragesResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1DoctorCoveragesResponse.fromJson(Map<String, Object?> json) => _$PostApiV1DoctorCoveragesResponseFromJson(json);
  
  final DoctorCoverage data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1DoctorCoveragesResponseToJson(this);
}
