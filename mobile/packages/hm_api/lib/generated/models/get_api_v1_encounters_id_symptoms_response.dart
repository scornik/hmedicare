// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'symptom_observation.dart';
import 'response_meta.dart';

part 'get_api_v1_encounters_id_symptoms_response.g.dart';

@JsonSerializable()
class GetApiV1EncountersIdSymptomsResponse {
  const GetApiV1EncountersIdSymptomsResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1EncountersIdSymptomsResponse.fromJson(Map<String, Object?> json) => _$GetApiV1EncountersIdSymptomsResponseFromJson(json);
  
  final List<SymptomObservation> data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1EncountersIdSymptomsResponseToJson(this);
}
