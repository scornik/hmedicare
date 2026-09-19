// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'patient_account_link_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PatientAccountLinkRequest _$PatientAccountLinkRequestFromJson(
  Map<String, dynamic> json,
) => PatientAccountLinkRequest(
  patientId: json['patientId'] as String,
  tenantId: json['tenantId'] as String,
);

Map<String, dynamic> _$PatientAccountLinkRequestToJson(
  PatientAccountLinkRequest instance,
) => <String, dynamic>{
  'patientId': instance.patientId,
  'tenantId': instance.tenantId,
};
