// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'ai_approved_diagnosis.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AiApprovedDiagnosis _$AiApprovedDiagnosisFromJson(Map<String, dynamic> json) =>
    AiApprovedDiagnosis(
      certainty: AiApprovedDiagnosisCertainty.fromJson(
        json['certainty'] as String,
      ),
      display: json['display'] as String,
      clinicalStatus: json['clinicalStatus'] == null
          ? null
          : AiApprovedDiagnosisClinicalStatus.fromJson(
              json['clinicalStatus'] as String,
            ),
      code: json['code'] as String?,
      codeSystem: json['codeSystem'] as String?,
      displayBn: json['displayBn'] as String?,
      notes: json['notes'] as String?,
    );

Map<String, dynamic> _$AiApprovedDiagnosisToJson(
  AiApprovedDiagnosis instance,
) => <String, dynamic>{
  'certainty': instance.certainty,
  'clinicalStatus': ?instance.clinicalStatus,
  'code': ?instance.code,
  'codeSystem': ?instance.codeSystem,
  'display': instance.display,
  'displayBn': ?instance.displayBn,
  'notes': ?instance.notes,
};
