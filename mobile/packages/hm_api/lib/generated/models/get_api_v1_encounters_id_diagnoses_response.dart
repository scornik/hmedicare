// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'diagnosis.dart';
import 'response_meta.dart';

part 'get_api_v1_encounters_id_diagnoses_response.g.dart';

@JsonSerializable()
class GetApiV1EncountersIdDiagnosesResponse {
  const GetApiV1EncountersIdDiagnosesResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1EncountersIdDiagnosesResponse.fromJson(Map<String, Object?> json) => _$GetApiV1EncountersIdDiagnosesResponseFromJson(json);
  
  final List<Diagnosis> data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1EncountersIdDiagnosesResponseToJson(this);
}
