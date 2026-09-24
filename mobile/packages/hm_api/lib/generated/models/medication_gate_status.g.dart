// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'medication_gate_status.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MedicationGateStatus _$MedicationGateStatusFromJson(
  Map<String, dynamic> json,
) => MedicationGateStatus(
  allAttested: json['allAttested'] as bool,
  datasetVersion: json['datasetVersion'] as String,
  gates: (json['gates'] as List<dynamic>)
      .map((e) => Gates.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$MedicationGateStatusToJson(
  MedicationGateStatus instance,
) => <String, dynamic>{
  'allAttested': instance.allAttested,
  'datasetVersion': instance.datasetVersion,
  'gates': instance.gates,
};
