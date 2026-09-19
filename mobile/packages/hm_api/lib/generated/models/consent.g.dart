// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'consent.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Consent _$ConsentFromJson(Map<String, dynamic> json) => Consent(
  capturedAt: DateTime.parse(json['capturedAt'] as String),
  givenByRelationship: ConsentGivenByRelationship.fromJson(
    json['givenByRelationship'] as String,
  ),
  id: json['id'] as String,
  patientId: json['patientId'] as String,
  policyVersion: (json['policyVersion'] as num).toInt(),
  purpose: ConsentPurpose.fromJson(json['purpose'] as String),
  rowVersion: (json['rowVersion'] as num).toInt(),
  status: ConsentStatus.fromJson(json['status'] as String),
  withdrawnAt: json['withdrawnAt'] == null
      ? null
      : DateTime.parse(json['withdrawnAt'] as String),
);

Map<String, dynamic> _$ConsentToJson(Consent instance) => <String, dynamic>{
  'capturedAt': instance.capturedAt.toIso8601String(),
  'givenByRelationship': instance.givenByRelationship,
  'id': instance.id,
  'patientId': instance.patientId,
  'policyVersion': instance.policyVersion,
  'purpose': instance.purpose,
  'rowVersion': instance.rowVersion,
  'status': instance.status,
  'withdrawnAt': ?instance.withdrawnAt?.toIso8601String(),
};
