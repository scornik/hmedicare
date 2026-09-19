// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'patient_summary.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PatientSummary _$PatientSummaryFromJson(Map<String, dynamic> json) =>
    PatientSummary(
      birthYear: (json['birthYear'] as num?)?.toInt(),
      displayName: json['displayName'] as String,
      id: json['id'] as String,
      legalName: json['legalName'] as String,
      legalNameBn: json['legalNameBn'] as String?,
      medicalRecordNumber: json['medicalRecordNumber'] as String,
      phoneMasked: json['phoneMasked'] as String?,
      sex: json['sex'] == null
          ? null
          : PatientSummarySex.fromJson(json['sex'] as String),
      status: PatientSummaryStatus.fromJson(json['status'] as String),
    );

Map<String, dynamic> _$PatientSummaryToJson(PatientSummary instance) =>
    <String, dynamic>{
      'birthYear': ?instance.birthYear,
      'displayName': instance.displayName,
      'id': instance.id,
      'legalName': instance.legalName,
      'legalNameBn': ?instance.legalNameBn,
      'medicalRecordNumber': instance.medicalRecordNumber,
      'phoneMasked': ?instance.phoneMasked,
      'sex': ?instance.sex,
      'status': instance.status,
    };
