// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'update_patient_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

UpdatePatientRequest _$UpdatePatientRequestFromJson(
  Map<String, dynamic> json,
) => UpdatePatientRequest(
  expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
  addContacts: (json['addContacts'] as List<dynamic>?)
      ?.map((e) => AddContacts.fromJson(e as Map<String, dynamic>))
      .toList(),
  address: json['address'] == null
      ? null
      : PatientAddress.fromJson(json['address'] as Map<String, dynamic>),
  birthYear: (json['birthYear'] as num?)?.toInt(),
  dateOfBirth: json['dateOfBirth'] as String?,
  displayName: json['displayName'] as String?,
  genderIdentity: json['genderIdentity'] as String?,
  legalName: json['legalName'] as String?,
  legalNameBn: json['legalNameBn'] as String?,
  preferredLocale: json['preferredLocale'] == null
      ? null
      : UpdatePatientRequestPreferredLocale.fromJson(
          json['preferredLocale'] as String,
        ),
  removeContactIds: (json['removeContactIds'] as List<dynamic>?)
      ?.map((e) => e as String)
      .toList(),
  sex: json['sex'] == null
      ? null
      : UpdatePatientRequestSex.fromJson(json['sex'] as String),
);

Map<String, dynamic> _$UpdatePatientRequestToJson(
  UpdatePatientRequest instance,
) => <String, dynamic>{
  'addContacts': ?instance.addContacts,
  'address': ?instance.address,
  'birthYear': ?instance.birthYear,
  'dateOfBirth': ?instance.dateOfBirth,
  'displayName': ?instance.displayName,
  'expectedRowVersion': instance.expectedRowVersion,
  'genderIdentity': ?instance.genderIdentity,
  'legalName': ?instance.legalName,
  'legalNameBn': ?instance.legalNameBn,
  'preferredLocale': ?instance.preferredLocale,
  'removeContactIds': ?instance.removeContactIds,
  'sex': ?instance.sex,
};
