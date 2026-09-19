// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'patient_search_response.dart';
import 'response_meta.dart';

part 'get_api_v1_patients_response.g.dart';

@JsonSerializable()
class GetApiV1PatientsResponse {
  const GetApiV1PatientsResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1PatientsResponse.fromJson(Map<String, Object?> json) => _$GetApiV1PatientsResponseFromJson(json);
  
  final PatientSearchResponse data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1PatientsResponseToJson(this);
}
