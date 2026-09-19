// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'patient_contact.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PatientContact _$PatientContactFromJson(Map<String, dynamic> json) =>
    PatientContact(
      displayValue: json['displayValue'] as String,
      id: json['id'] as String,
      isPreferred: json['isPreferred'] as bool,
      relationship: PatientContactRelationship.fromJson(
        json['relationship'] as String,
      ),
      rowVersion: (json['rowVersion'] as num).toInt(),
      status: PatientContactStatus.fromJson(json['status'] as String),
      type: PatientContactType.fromJson(json['type'] as String),
      verificationStatus: PatientContactVerificationStatus.fromJson(
        json['verificationStatus'] as String,
      ),
    );

Map<String, dynamic> _$PatientContactToJson(PatientContact instance) =>
    <String, dynamic>{
      'displayValue': instance.displayValue,
      'id': instance.id,
      'isPreferred': instance.isPreferred,
      'relationship': instance.relationship,
      'rowVersion': instance.rowVersion,
      'status': instance.status,
      'type': instance.type,
      'verificationStatus': instance.verificationStatus,
    };
