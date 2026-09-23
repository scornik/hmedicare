// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'symptom_observation.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SymptomObservation _$SymptomObservationFromJson(Map<String, dynamic> json) =>
    SymptomObservation(
      certainty: SymptomObservationCertainty.fromJson(
        json['certainty'] as String,
      ),
      codeSystem: json['codeSystem'] as String?,
      createdAt: DateTime.parse(json['createdAt'] as String),
      detail: json['detail'] as String?,
      display: json['display'] as String,
      encounterId: json['encounterId'] as String,
      id: json['id'] as String,
      normalizedCode: json['normalizedCode'] as String?,
      onset: json['onset'] as String?,
      patientId: json['patientId'] as String,
      rowVersion: (json['rowVersion'] as num).toInt(),
      severity: json['severity'] == null
          ? null
          : SymptomObservationSeverity.fromJson(json['severity'] as String),
      source: SymptomObservationSource.fromJson(json['source'] as String),
      status: SymptomObservationStatus.fromJson(json['status'] as String),
    );

Map<String, dynamic> _$SymptomObservationToJson(SymptomObservation instance) =>
    <String, dynamic>{
      'certainty': instance.certainty,
      'codeSystem': ?instance.codeSystem,
      'createdAt': instance.createdAt.toIso8601String(),
      'detail': ?instance.detail,
      'display': instance.display,
      'encounterId': instance.encounterId,
      'id': instance.id,
      'normalizedCode': ?instance.normalizedCode,
      'onset': ?instance.onset,
      'patientId': instance.patientId,
      'rowVersion': instance.rowVersion,
      'severity': ?instance.severity,
      'source': instance.source,
      'status': instance.status,
    };
