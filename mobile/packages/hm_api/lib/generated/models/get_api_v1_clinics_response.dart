// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'clinic.dart';
import 'response_meta.dart';

part 'get_api_v1_clinics_response.g.dart';

@JsonSerializable()
class GetApiV1ClinicsResponse {
  const GetApiV1ClinicsResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1ClinicsResponse.fromJson(Map<String, Object?> json) => _$GetApiV1ClinicsResponseFromJson(json);
  
  final List<Clinic> data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1ClinicsResponseToJson(this);
}
