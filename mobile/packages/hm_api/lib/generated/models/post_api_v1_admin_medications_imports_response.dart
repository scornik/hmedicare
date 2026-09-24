// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'request_medication_import_response.dart';
import 'response_meta.dart';

part 'post_api_v1_admin_medications_imports_response.g.dart';

@JsonSerializable()
class PostApiV1AdminMedicationsImportsResponse {
  const PostApiV1AdminMedicationsImportsResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1AdminMedicationsImportsResponse.fromJson(Map<String, Object?> json) => _$PostApiV1AdminMedicationsImportsResponseFromJson(json);
  
  final RequestMedicationImportResponse data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1AdminMedicationsImportsResponseToJson(this);
}
