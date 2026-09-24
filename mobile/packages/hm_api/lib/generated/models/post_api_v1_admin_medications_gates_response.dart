// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'record_medication_gate_response.dart';
import 'response_meta.dart';

part 'post_api_v1_admin_medications_gates_response.g.dart';

@JsonSerializable()
class PostApiV1AdminMedicationsGatesResponse {
  const PostApiV1AdminMedicationsGatesResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1AdminMedicationsGatesResponse.fromJson(Map<String, Object?> json) => _$PostApiV1AdminMedicationsGatesResponseFromJson(json);
  
  final RecordMedicationGateResponse data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1AdminMedicationsGatesResponseToJson(this);
}
