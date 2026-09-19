// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'create_patient_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CreatePatientRequest _$CreatePatientRequestFromJson(
  Map<String, dynamic> json,
) => CreatePatientRequest(
  contacts: (json['contacts'] as List<dynamic>)
      .map((e) => Contacts.fromJson(e as Map<String, dynamic>))
      .toList(),
  legalName: json['legalName'] as String,
  consents:
      (json['consents'] as List<dynamic>?)
          ?.map((e) => CreatePatientRequestConsents.fromJson(e as String))
          .toList() ??
      const [],
  address: json['address'] == null
      ? null
      : PatientAddress.fromJson(json['address'] as Map<String, dynamic>),
  birthYear: (json['birthYear'] as num?)?.toInt(),
  dateOfBirth: json['dateOfBirth'] as String?,
  displayName: json['displayName'] as String?,
  duplicateReview: json['duplicateReview'] == null
      ? null
      : DuplicateReview.fromJson(
          json['duplicateReview'] as Map<String, dynamic>,
        ),
  genderIdentity: json['genderIdentity'] as String?,
  legalNameBn: json['legalNameBn'] as String?,
  preferredLocale: json['preferredLocale'] == null
      ? null
      : CreatePatientRequestPreferredLocale.fromJson(
          json['preferredLocale'] as String,
        ),
  sex: json['sex'] == null
      ? null
      : CreatePatientRequestSex.fromJson(json['sex'] as String),
);

Map<String, dynamic> _$CreatePatientRequestToJson(
  CreatePatientRequest instance,
) => <String, dynamic>{
  'address': ?instance.address,
  'birthYear': ?instance.birthYear,
  'consents': instance.consents,
  'contacts': instance.contacts,
  'dateOfBirth': ?instance.dateOfBirth,
  'displayName': ?instance.displayName,
  'duplicateReview': ?instance.duplicateReview,
  'genderIdentity': ?instance.genderIdentity,
  'legalName': instance.legalName,
  'legalNameBn': ?instance.legalNameBn,
  'preferredLocale': ?instance.preferredLocale,
  'sex': ?instance.sex,
};
