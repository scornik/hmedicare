// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'clinic.dart';
import 'response_meta.dart';

part 'patch_api_v1_clinics_id_response.g.dart';

@JsonSerializable()
class PatchApiV1ClinicsIdResponse {
  const PatchApiV1ClinicsIdResponse({
    required this.data,
    required this.meta,
  });
  
  factory PatchApiV1ClinicsIdResponse.fromJson(Map<String, Object?> json) => _$PatchApiV1ClinicsIdResponseFromJson(json);
  
  final Clinic data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PatchApiV1ClinicsIdResponseToJson(this);
}
