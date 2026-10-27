// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'api_v1_lab_reports_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ApiV1LabReportsRequestBody _$ApiV1LabReportsRequestBodyFromJson(
  Map<String, dynamic> json,
) => ApiV1LabReportsRequestBody(
  documentId: json['documentId'] as String,
  labName: json['labName'] as String?,
  reportDate: json['reportDate'] as String?,
);

Map<String, dynamic> _$ApiV1LabReportsRequestBodyToJson(
  ApiV1LabReportsRequestBody instance,
) => <String, dynamic>{
  'documentId': instance.documentId,
  'labName': ?instance.labName,
  'reportDate': ?instance.reportDate,
};
