// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'api_v1_lab_reports_id_share_request_body.g.dart';

@JsonSerializable()
class ApiV1LabReportsIdShareRequestBody {
  const ApiV1LabReportsIdShareRequestBody({
    required this.expectedRowVersion,
  });
  
  factory ApiV1LabReportsIdShareRequestBody.fromJson(Map<String, Object?> json) => _$ApiV1LabReportsIdShareRequestBodyFromJson(json);
  
  final int expectedRowVersion;

  Map<String, Object?> toJson() => _$ApiV1LabReportsIdShareRequestBodyToJson(this);
}
