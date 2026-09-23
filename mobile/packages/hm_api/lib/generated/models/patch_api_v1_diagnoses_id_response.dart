// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'diagnosis.dart';
import 'response_meta.dart';

part 'patch_api_v1_diagnoses_id_response.g.dart';

@JsonSerializable()
class PatchApiV1DiagnosesIdResponse {
  const PatchApiV1DiagnosesIdResponse({
    required this.data,
    required this.meta,
  });
  
  factory PatchApiV1DiagnosesIdResponse.fromJson(Map<String, Object?> json) => _$PatchApiV1DiagnosesIdResponseFromJson(json);
  
  final Diagnosis data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PatchApiV1DiagnosesIdResponseToJson(this);
}
