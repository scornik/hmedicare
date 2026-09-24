// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'request_medication_import_request.g.dart';

@JsonSerializable()
class RequestMedicationImportRequest {
  const RequestMedicationImportRequest({
    required this.datasetVersion,
    this.dryRun,
    this.excludeVeterinary,
  });
  
  factory RequestMedicationImportRequest.fromJson(Map<String, Object?> json) => _$RequestMedicationImportRequestFromJson(json);
  
  final String datasetVersion;

  /// Verify and count without writing a single catalog row
  final bool? dryRun;

  /// Defaults to true. Veterinary products are not offered to a human prescriber
  final bool? excludeVeterinary;

  Map<String, Object?> toJson() => _$RequestMedicationImportRequestToJson(this);
}
