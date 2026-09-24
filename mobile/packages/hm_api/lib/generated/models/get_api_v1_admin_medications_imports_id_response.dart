// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'medication_import.dart';
import 'response_meta.dart';

part 'get_api_v1_admin_medications_imports_id_response.g.dart';

@JsonSerializable()
class GetApiV1AdminMedicationsImportsIdResponse {
  const GetApiV1AdminMedicationsImportsIdResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1AdminMedicationsImportsIdResponse.fromJson(Map<String, Object?> json) => _$GetApiV1AdminMedicationsImportsIdResponseFromJson(json);
  
  final MedicationImport data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1AdminMedicationsImportsIdResponseToJson(this);
}
