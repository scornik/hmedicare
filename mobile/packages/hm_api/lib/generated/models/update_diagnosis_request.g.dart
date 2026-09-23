// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'update_diagnosis_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

UpdateDiagnosisRequest _$UpdateDiagnosisRequestFromJson(
  Map<String, dynamic> json,
) => UpdateDiagnosisRequest(
  expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
  certainty: json['certainty'] == null
      ? null
      : UpdateDiagnosisRequestCertainty.fromJson(json['certainty'] as String),
  clinicalStatus: json['clinicalStatus'] == null
      ? null
      : UpdateDiagnosisRequestClinicalStatus.fromJson(
          json['clinicalStatus'] as String,
        ),
  code: json['code'] as String?,
  codeSystem: json['codeSystem'] as String?,
  display: json['display'] as String?,
  displayBn: json['displayBn'] as String?,
  notes: json['notes'] as String?,
);

Map<String, dynamic> _$UpdateDiagnosisRequestToJson(
  UpdateDiagnosisRequest instance,
) => <String, dynamic>{
  'certainty': ?instance.certainty,
  'clinicalStatus': ?instance.clinicalStatus,
  'code': ?instance.code,
  'codeSystem': ?instance.codeSystem,
  'display': ?instance.display,
  'displayBn': ?instance.displayBn,
  'expectedRowVersion': instance.expectedRowVersion,
  'notes': ?instance.notes,
};
