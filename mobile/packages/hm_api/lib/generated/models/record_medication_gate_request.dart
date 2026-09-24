// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'record_medication_gate_request_gate_code.dart';

part 'record_medication_gate_request.g.dart';

@JsonSerializable()
class RecordMedicationGateRequest {
  const RecordMedicationGateRequest({
    required this.datasetVersion,
    required this.evidenceRef,
    required this.gateCode,
    required this.summary,
  });
  
  factory RecordMedicationGateRequest.fromJson(Map<String, Object?> json) => _$RecordMedicationGateRequestFromJson(json);
  
  final String datasetVersion;

  /// Where the review lives: a document, a ticket, a signed report
  final String evidenceRef;
  final RecordMedicationGateRequestGateCode gateCode;

  /// What was reviewed and what it found — a sample size and an error rate, for example
  final String summary;

  Map<String, Object?> toJson() => _$RecordMedicationGateRequestToJson(this);
}
