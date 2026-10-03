// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'approve_prescription_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ApprovePrescriptionRequest _$ApprovePrescriptionRequestFromJson(
  Map<String, dynamic> json,
) => ApprovePrescriptionRequest(
  attestationVersion: (json['attestationVersion'] as num).toInt(),
  expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
);

Map<String, dynamic> _$ApprovePrescriptionRequestToJson(
  ApprovePrescriptionRequest instance,
) => <String, dynamic>{
  'attestationVersion': instance.attestationVersion,
  'expectedRowVersion': instance.expectedRowVersion,
};
