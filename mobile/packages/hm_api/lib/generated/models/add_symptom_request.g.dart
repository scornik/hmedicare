// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'add_symptom_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AddSymptomRequest _$AddSymptomRequestFromJson(Map<String, dynamic> json) =>
    AddSymptomRequest(
      certainty: AddSymptomRequestCertainty.fromJson(
        json['certainty'] as String,
      ),
      display: json['display'] as String,
      source: AddSymptomRequestSource.fromJson(json['source'] as String),
      codeSystem: json['codeSystem'] as String?,
      detail: json['detail'] as String?,
      normalizedCode: json['normalizedCode'] as String?,
      onset: json['onset'] as String?,
      severity: json['severity'] == null
          ? null
          : AddSymptomRequestSeverity.fromJson(json['severity'] as String),
    );

Map<String, dynamic> _$AddSymptomRequestToJson(AddSymptomRequest instance) =>
    <String, dynamic>{
      'certainty': instance.certainty,
      'codeSystem': ?instance.codeSystem,
      'detail': ?instance.detail,
      'display': instance.display,
      'normalizedCode': ?instance.normalizedCode,
      'onset': ?instance.onset,
      'severity': ?instance.severity,
      'source': instance.source,
    };
