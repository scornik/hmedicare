// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'data8.dart';
import 'response_meta.dart';

part 'get_api_v1_lab_reports_patient_mine_response.g.dart';

@JsonSerializable()
class GetApiV1LabReportsPatientMineResponse {
  const GetApiV1LabReportsPatientMineResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1LabReportsPatientMineResponse.fromJson(Map<String, Object?> json) => _$GetApiV1LabReportsPatientMineResponseFromJson(json);
  
  final Data8 data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1LabReportsPatientMineResponseToJson(this);
}
