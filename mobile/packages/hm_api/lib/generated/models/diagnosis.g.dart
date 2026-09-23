// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'diagnosis.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Diagnosis _$DiagnosisFromJson(Map<String, dynamic> json) => Diagnosis(
  authorDoctorProfileId: json['authorDoctorProfileId'] as String,
  certainty: DiagnosisCertainty.fromJson(json['certainty'] as String),
  clinicalStatus: DiagnosisClinicalStatus.fromJson(
    json['clinicalStatus'] as String,
  ),
  code: json['code'] as String?,
  codeSystem: json['codeSystem'] as String?,
  createdAt: DateTime.parse(json['createdAt'] as String),
  display: json['display'] as String,
  displayBn: json['displayBn'] as String?,
  encounterId: json['encounterId'] as String,
  id: json['id'] as String,
  notes: json['notes'] as String?,
  patientId: json['patientId'] as String,
  replacesDiagnosisId: json['replacesDiagnosisId'] as String?,
  rowVersion: (json['rowVersion'] as num).toInt(),
  source: DiagnosisSource.fromJson(json['source'] as String),
  voidReason: json['voidReason'] as String?,
  voidedAt: json['voidedAt'] == null
      ? null
      : DateTime.parse(json['voidedAt'] as String),
);

Map<String, dynamic> _$DiagnosisToJson(Diagnosis instance) => <String, dynamic>{
  'authorDoctorProfileId': instance.authorDoctorProfileId,
  'certainty': instance.certainty,
  'clinicalStatus': instance.clinicalStatus,
  'code': ?instance.code,
  'codeSystem': ?instance.codeSystem,
  'createdAt': instance.createdAt.toIso8601String(),
  'display': instance.display,
  'displayBn': ?instance.displayBn,
  'encounterId': instance.encounterId,
  'id': instance.id,
  'notes': ?instance.notes,
  'patientId': instance.patientId,
  'replacesDiagnosisId': ?instance.replacesDiagnosisId,
  'rowVersion': instance.rowVersion,
  'source': instance.source,
  'voidReason': ?instance.voidReason,
  'voidedAt': ?instance.voidedAt?.toIso8601String(),
};
