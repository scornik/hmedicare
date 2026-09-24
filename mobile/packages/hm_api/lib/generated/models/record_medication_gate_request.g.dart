// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'record_medication_gate_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

RecordMedicationGateRequest _$RecordMedicationGateRequestFromJson(
  Map<String, dynamic> json,
) => RecordMedicationGateRequest(
  datasetVersion: json['datasetVersion'] as String,
  evidenceRef: json['evidenceRef'] as String,
  gateCode: RecordMedicationGateRequestGateCode.fromJson(
    json['gateCode'] as String,
  ),
  summary: json['summary'] as String,
);

Map<String, dynamic> _$RecordMedicationGateRequestToJson(
  RecordMedicationGateRequest instance,
) => <String, dynamic>{
  'datasetVersion': instance.datasetVersion,
  'evidenceRef': instance.evidenceRef,
  'gateCode': instance.gateCode,
  'summary': instance.summary,
};
