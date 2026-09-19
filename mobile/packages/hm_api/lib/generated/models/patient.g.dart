// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'patient.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Patient _$PatientFromJson(Map<String, dynamic> json) => Patient(
  address: json['address'] == null
      ? null
      : PatientAddress.fromJson(json['address'] as Map<String, dynamic>),
  birthYear: (json['birthYear'] as num?)?.toInt(),
  contacts: (json['contacts'] as List<dynamic>)
      .map((e) => PatientContact.fromJson(e as Map<String, dynamic>))
      .toList(),
  createdAt: DateTime.parse(json['createdAt'] as String),
  dateOfBirth: json['dateOfBirth'] as String?,
  displayName: json['displayName'] as String,
  genderIdentity: json['genderIdentity'] as String?,
  id: json['id'] as String,
  legalName: json['legalName'] as String,
  legalNameBn: json['legalNameBn'] as String?,
  medicalRecordNumber: json['medicalRecordNumber'] as String,
  mergedIntoPatientId: json['mergedIntoPatientId'] as String?,
  preferredLocale: json['preferredLocale'] == null
      ? null
      : PatientPreferredLocale.fromJson(json['preferredLocale'] as String),
  rowVersion: (json['rowVersion'] as num).toInt(),
  sex: json['sex'] == null ? null : PatientSex.fromJson(json['sex'] as String),
  status: PatientStatus.fromJson(json['status'] as String),
  updatedAt: DateTime.parse(json['updatedAt'] as String),
);

Map<String, dynamic> _$PatientToJson(Patient instance) => <String, dynamic>{
  'address': ?instance.address,
  'birthYear': ?instance.birthYear,
  'contacts': instance.contacts,
  'createdAt': instance.createdAt.toIso8601String(),
  'dateOfBirth': ?instance.dateOfBirth,
  'displayName': instance.displayName,
  'genderIdentity': ?instance.genderIdentity,
  'id': instance.id,
  'legalName': instance.legalName,
  'legalNameBn': ?instance.legalNameBn,
  'medicalRecordNumber': instance.medicalRecordNumber,
  'mergedIntoPatientId': ?instance.mergedIntoPatientId,
  'preferredLocale': ?instance.preferredLocale,
  'rowVersion': instance.rowVersion,
  'sex': ?instance.sex,
  'status': instance.status,
  'updatedAt': instance.updatedAt.toIso8601String(),
};
