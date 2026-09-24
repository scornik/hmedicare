// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'medication_gate_status.dart';
import 'response_meta.dart';

part 'get_api_v1_admin_medications_gates_dataset_version_response.g.dart';

@JsonSerializable()
class GetApiV1AdminMedicationsGatesDatasetVersionResponse {
  const GetApiV1AdminMedicationsGatesDatasetVersionResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1AdminMedicationsGatesDatasetVersionResponse.fromJson(Map<String, Object?> json) => _$GetApiV1AdminMedicationsGatesDatasetVersionResponseFromJson(json);
  
  final MedicationGateStatus data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1AdminMedicationsGatesDatasetVersionResponseToJson(this);
}
