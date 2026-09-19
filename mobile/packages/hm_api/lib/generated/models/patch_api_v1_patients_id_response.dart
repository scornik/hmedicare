// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'patient.dart';
import 'response_meta.dart';

part 'patch_api_v1_patients_id_response.g.dart';

@JsonSerializable()
class PatchApiV1PatientsIdResponse {
  const PatchApiV1PatientsIdResponse({
    required this.data,
    required this.meta,
  });
  
  factory PatchApiV1PatientsIdResponse.fromJson(Map<String, Object?> json) => _$PatchApiV1PatientsIdResponseFromJson(json);
  
  final Patient data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PatchApiV1PatientsIdResponseToJson(this);
}
