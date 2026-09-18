// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'patient_context.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PatientContext _$PatientContextFromJson(Map<String, dynamic> json) =>
    PatientContext(
      authorityScope: (json['authorityScope'] as List<dynamic>)
          .map((e) => e as String)
          .toList(),
      patientDisplayName: json['patientDisplayName'] as String,
      patientId: json['patientId'] as String,
      relationship: json['relationship'] as String,
      tenantId: json['tenantId'] as String,
      tenantName: json['tenantName'] as String,
    );

Map<String, dynamic> _$PatientContextToJson(PatientContext instance) =>
    <String, dynamic>{
      'authorityScope': instance.authorityScope,
      'patientDisplayName': instance.patientDisplayName,
      'patientId': instance.patientId,
      'relationship': instance.relationship,
      'tenantId': instance.tenantId,
      'tenantName': instance.tenantName,
    };
