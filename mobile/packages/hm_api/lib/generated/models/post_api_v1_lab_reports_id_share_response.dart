// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'lab_report_view.dart';
import 'response_meta.dart';

part 'post_api_v1_lab_reports_id_share_response.g.dart';

@JsonSerializable()
class PostApiV1LabReportsIdShareResponse {
  const PostApiV1LabReportsIdShareResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1LabReportsIdShareResponse.fromJson(Map<String, Object?> json) => _$PostApiV1LabReportsIdShareResponseFromJson(json);
  
  final LabReportView data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1LabReportsIdShareResponseToJson(this);
}
