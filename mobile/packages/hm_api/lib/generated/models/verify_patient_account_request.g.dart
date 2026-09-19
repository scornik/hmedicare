// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'verify_patient_account_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

VerifyPatientAccountRequest _$VerifyPatientAccountRequestFromJson(
  Map<String, dynamic> json,
) => VerifyPatientAccountRequest(
  expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
  method: VerifyPatientAccountRequestMethod.fromJson(json['method'] as String),
);

Map<String, dynamic> _$VerifyPatientAccountRequestToJson(
  VerifyPatientAccountRequest instance,
) => <String, dynamic>{
  'expectedRowVersion': instance.expectedRowVersion,
  'method': instance.method,
};
