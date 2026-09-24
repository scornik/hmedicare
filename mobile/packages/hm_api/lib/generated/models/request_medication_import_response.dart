// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'request_medication_import_response.g.dart';

@JsonSerializable()
class RequestMedicationImportResponse {
  const RequestMedicationImportResponse({
    required this.created,
    required this.datasetVersion,
    required this.jobId,
  });
  
  factory RequestMedicationImportResponse.fromJson(Map<String, Object?> json) => _$RequestMedicationImportResponseFromJson(json);
  
  /// False when this request was already queued; the existing job is returned
  final bool created;
  final String datasetVersion;
  final String jobId;

  Map<String, Object?> toJson() => _$RequestMedicationImportResponseToJson(this);
}
