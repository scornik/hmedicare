// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'symptom_observation.dart';
import 'response_meta.dart';

part 'post_api_v1_encounters_id_symptoms_response.g.dart';

@JsonSerializable()
class PostApiV1EncountersIdSymptomsResponse {
  const PostApiV1EncountersIdSymptomsResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1EncountersIdSymptomsResponse.fromJson(Map<String, Object?> json) => _$PostApiV1EncountersIdSymptomsResponseFromJson(json);
  
  final SymptomObservation data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1EncountersIdSymptomsResponseToJson(this);
}
