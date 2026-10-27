// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'data7.dart';
import 'response_meta.dart';

part 'get_api_v1_lab_reports_by_encounter_encounter_id_response.g.dart';

@JsonSerializable()
class GetApiV1LabReportsByEncounterEncounterIdResponse {
  const GetApiV1LabReportsByEncounterEncounterIdResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1LabReportsByEncounterEncounterIdResponse.fromJson(Map<String, Object?> json) => _$GetApiV1LabReportsByEncounterEncounterIdResponseFromJson(json);
  
  final Data7 data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1LabReportsByEncounterEncounterIdResponseToJson(this);
}
