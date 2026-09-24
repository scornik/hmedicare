// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'request_medication_import_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

RequestMedicationImportResponse _$RequestMedicationImportResponseFromJson(
  Map<String, dynamic> json,
) => RequestMedicationImportResponse(
  created: json['created'] as bool,
  datasetVersion: json['datasetVersion'] as String,
  jobId: json['jobId'] as String,
);

Map<String, dynamic> _$RequestMedicationImportResponseToJson(
  RequestMedicationImportResponse instance,
) => <String, dynamic>{
  'created': instance.created,
  'datasetVersion': instance.datasetVersion,
  'jobId': instance.jobId,
};
