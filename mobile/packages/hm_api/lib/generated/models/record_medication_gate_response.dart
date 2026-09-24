// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'record_medication_gate_response.g.dart';

@JsonSerializable()
class RecordMedicationGateResponse {
  const RecordMedicationGateResponse({
    required this.id,
    required this.seq,
  });
  
  factory RecordMedicationGateResponse.fromJson(Map<String, Object?> json) => _$RecordMedicationGateResponseFromJson(json);
  
  final String id;

  /// Position in the append-only attestation hash chain
  final String seq;

  Map<String, Object?> toJson() => _$RecordMedicationGateResponseToJson(this);
}
