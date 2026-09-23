// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'encounter_summary.dart';
import 'response_meta.dart';

part 'get_api_v1_patients_id_encounters_response.g.dart';

@JsonSerializable()
class GetApiV1PatientsIdEncountersResponse {
  const GetApiV1PatientsIdEncountersResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1PatientsIdEncountersResponse.fromJson(Map<String, Object?> json) => _$GetApiV1PatientsIdEncountersResponseFromJson(json);
  
  final List<EncounterSummary> data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1PatientsIdEncountersResponseToJson(this);
}
