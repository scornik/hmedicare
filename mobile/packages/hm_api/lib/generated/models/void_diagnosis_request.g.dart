// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'void_diagnosis_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

VoidDiagnosisRequest _$VoidDiagnosisRequestFromJson(
  Map<String, dynamic> json,
) => VoidDiagnosisRequest(
  expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
  reason: json['reason'] as String,
);

Map<String, dynamic> _$VoidDiagnosisRequestToJson(
  VoidDiagnosisRequest instance,
) => <String, dynamic>{
  'expectedRowVersion': instance.expectedRowVersion,
  'reason': instance.reason,
};
