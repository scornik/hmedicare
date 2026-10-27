// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'data9.dart';
import 'response_meta.dart';

part 'post_api_v1_lab_reports_id_results_response.g.dart';

@JsonSerializable()
class PostApiV1LabReportsIdResultsResponse {
  const PostApiV1LabReportsIdResultsResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1LabReportsIdResultsResponse.fromJson(Map<String, Object?> json) => _$PostApiV1LabReportsIdResultsResponseFromJson(json);
  
  final Data9 data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1LabReportsIdResultsResponseToJson(this);
}
