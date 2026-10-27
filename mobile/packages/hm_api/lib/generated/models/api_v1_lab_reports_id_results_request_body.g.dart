// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'api_v1_lab_reports_id_results_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ApiV1LabReportsIdResultsRequestBody
_$ApiV1LabReportsIdResultsRequestBodyFromJson(Map<String, dynamic> json) =>
    ApiV1LabReportsIdResultsRequestBody(
      analyteDisplay: json['analyteDisplay'] as String,
      expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
      abnormalFlag: json['abnormalFlag'] == null
          ? null
          : AbnormalFlag.fromJson(json['abnormalFlag'] as String),
      referenceRange: json['referenceRange'] as String?,
      unit: json['unit'] as String?,
      valueNumeric: json['valueNumeric'] as String?,
      valueText: json['valueText'] as String?,
    );

Map<String, dynamic> _$ApiV1LabReportsIdResultsRequestBodyToJson(
  ApiV1LabReportsIdResultsRequestBody instance,
) => <String, dynamic>{
  'abnormalFlag': ?instance.abnormalFlag,
  'analyteDisplay': instance.analyteDisplay,
  'expectedRowVersion': instance.expectedRowVersion,
  'referenceRange': ?instance.referenceRange,
  'unit': ?instance.unit,
  'valueNumeric': ?instance.valueNumeric,
  'valueText': ?instance.valueText,
};
