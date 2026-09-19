// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'patient_account.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PatientAccount _$PatientAccountFromJson(Map<String, dynamic> json) =>
    PatientAccount(
      createdAt: DateTime.parse(json['createdAt'] as String),
      id: json['id'] as String,
      patientId: json['patientId'] as String,
      relationship: PatientAccountRelationship.fromJson(
        json['relationship'] as String,
      ),
      rowVersion: (json['rowVersion'] as num).toInt(),
      status: PatientAccountStatus.fromJson(json['status'] as String),
      userId: json['userId'] as String,
      verificationMethod: PatientAccountVerificationMethod.fromJson(
        json['verificationMethod'] as String,
      ),
      verifiedAt: json['verifiedAt'] == null
          ? null
          : DateTime.parse(json['verifiedAt'] as String),
    );

Map<String, dynamic> _$PatientAccountToJson(PatientAccount instance) =>
    <String, dynamic>{
      'createdAt': instance.createdAt.toIso8601String(),
      'id': instance.id,
      'patientId': instance.patientId,
      'relationship': instance.relationship,
      'rowVersion': instance.rowVersion,
      'status': instance.status,
      'userId': instance.userId,
      'verificationMethod': instance.verificationMethod,
      'verifiedAt': ?instance.verifiedAt?.toIso8601String(),
    };
