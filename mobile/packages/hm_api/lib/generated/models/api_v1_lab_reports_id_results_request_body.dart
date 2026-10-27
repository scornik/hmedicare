// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'abnormal_flag.dart';

part 'api_v1_lab_reports_id_results_request_body.g.dart';

@JsonSerializable()
class ApiV1LabReportsIdResultsRequestBody {
  const ApiV1LabReportsIdResultsRequestBody({
    required this.analyteDisplay,
    required this.expectedRowVersion,
    this.abnormalFlag,
    this.referenceRange,
    this.unit,
    this.valueNumeric,
    this.valueText,
  });
  
  factory ApiV1LabReportsIdResultsRequestBody.fromJson(Map<String, Object?> json) => _$ApiV1LabReportsIdResultsRequestBodyFromJson(json);
  
  final AbnormalFlag? abnormalFlag;
  final String analyteDisplay;
  final int expectedRowVersion;
  final String? referenceRange;
  final String? unit;
  final String? valueNumeric;
  final String? valueText;

  Map<String, Object?> toJson() => _$ApiV1LabReportsIdResultsRequestBodyToJson(this);
}
