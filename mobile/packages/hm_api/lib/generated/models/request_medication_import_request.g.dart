// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'request_medication_import_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

RequestMedicationImportRequest _$RequestMedicationImportRequestFromJson(
  Map<String, dynamic> json,
) => RequestMedicationImportRequest(
  datasetVersion: json['datasetVersion'] as String,
  dryRun: json['dryRun'] as bool?,
  excludeVeterinary: json['excludeVeterinary'] as bool?,
);

Map<String, dynamic> _$RequestMedicationImportRequestToJson(
  RequestMedicationImportRequest instance,
) => <String, dynamic>{
  'datasetVersion': instance.datasetVersion,
  'dryRun': ?instance.dryRun,
  'excludeVeterinary': ?instance.excludeVeterinary,
};
