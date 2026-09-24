// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'medication_import_list.dart';
import 'response_meta.dart';

part 'get_api_v1_admin_medications_imports_response.g.dart';

@JsonSerializable()
class GetApiV1AdminMedicationsImportsResponse {
  const GetApiV1AdminMedicationsImportsResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1AdminMedicationsImportsResponse.fromJson(Map<String, Object?> json) => _$GetApiV1AdminMedicationsImportsResponseFromJson(json);
  
  final MedicationImportList data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1AdminMedicationsImportsResponseToJson(this);
}
