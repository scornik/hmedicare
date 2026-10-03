// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'void_prescription_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

VoidPrescriptionRequest _$VoidPrescriptionRequestFromJson(
  Map<String, dynamic> json,
) => VoidPrescriptionRequest(
  expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
  reason: json['reason'] as String,
  clinicalReviewerDoctorProfileId:
      json['clinicalReviewerDoctorProfileId'] as String?,
);

Map<String, dynamic> _$VoidPrescriptionRequestToJson(
  VoidPrescriptionRequest instance,
) => <String, dynamic>{
  'clinicalReviewerDoctorProfileId': ?instance.clinicalReviewerDoctorProfileId,
  'expectedRowVersion': instance.expectedRowVersion,
  'reason': instance.reason,
};
