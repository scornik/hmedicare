// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'data2.dart';
import 'response_meta.dart';

part 'get_api_v1_documents_patient_upload_encounters_response.g.dart';

@JsonSerializable()
class GetApiV1DocumentsPatientUploadEncountersResponse {
  const GetApiV1DocumentsPatientUploadEncountersResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1DocumentsPatientUploadEncountersResponse.fromJson(Map<String, Object?> json) => _$GetApiV1DocumentsPatientUploadEncountersResponseFromJson(json);
  
  final Data2 data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1DocumentsPatientUploadEncountersResponseToJson(this);
}
