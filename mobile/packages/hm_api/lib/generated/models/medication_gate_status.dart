// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'gates.dart';

part 'medication_gate_status.g.dart';

@JsonSerializable()
class MedicationGateStatus {
  const MedicationGateStatus({
    required this.allAttested,
    required this.datasetVersion,
    required this.gates,
  });
  
  factory MedicationGateStatus.fromJson(Map<String, Object?> json) => _$MedicationGateStatusFromJson(json);
  
  /// Production imports are refused until every gate is attested for that exact version
  final bool allAttested;
  final String datasetVersion;
  final List<Gates> gates;

  Map<String, Object?> toJson() => _$MedicationGateStatusToJson(this);
}
