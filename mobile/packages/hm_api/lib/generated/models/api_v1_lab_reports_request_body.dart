// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'api_v1_lab_reports_request_body.g.dart';

@JsonSerializable()
class ApiV1LabReportsRequestBody {
  const ApiV1LabReportsRequestBody({
    required this.documentId,
    this.labName,
    this.reportDate,
  });
  
  factory ApiV1LabReportsRequestBody.fromJson(Map<String, Object?> json) => _$ApiV1LabReportsRequestBodyFromJson(json);
  
  final String documentId;
  final String? labName;
  final String? reportDate;

  Map<String, Object?> toJson() => _$ApiV1LabReportsRequestBodyToJson(this);
}
