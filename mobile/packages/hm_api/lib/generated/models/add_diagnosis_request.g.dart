// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'add_diagnosis_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AddDiagnosisRequest _$AddDiagnosisRequestFromJson(Map<String, dynamic> json) =>
    AddDiagnosisRequest(
      certainty: AddDiagnosisRequestCertainty.fromJson(
        json['certainty'] as String,
      ),
      display: json['display'] as String,
      clinicalStatus: json['clinicalStatus'] == null
          ? null
          : AddDiagnosisRequestClinicalStatus.fromJson(
              json['clinicalStatus'] as String,
            ),
      code: json['code'] as String?,
      codeSystem: json['codeSystem'] as String?,
      displayBn: json['displayBn'] as String?,
      notes: json['notes'] as String?,
      replacesDiagnosisId: json['replacesDiagnosisId'] as String?,
    );

Map<String, dynamic> _$AddDiagnosisRequestToJson(
  AddDiagnosisRequest instance,
) => <String, dynamic>{
  'certainty': instance.certainty,
  'clinicalStatus': ?instance.clinicalStatus,
  'code': ?instance.code,
  'codeSystem': ?instance.codeSystem,
  'display': instance.display,
  'displayBn': ?instance.displayBn,
  'notes': ?instance.notes,
  'replacesDiagnosisId': ?instance.replacesDiagnosisId,
};
