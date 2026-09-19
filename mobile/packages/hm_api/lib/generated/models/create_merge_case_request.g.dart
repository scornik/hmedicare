// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'create_merge_case_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CreateMergeCaseRequest _$CreateMergeCaseRequestFromJson(
  Map<String, dynamic> json,
) => CreateMergeCaseRequest(
  reason: json['reason'] as String,
  targetPatientId: json['targetPatientId'] as String,
);

Map<String, dynamic> _$CreateMergeCaseRequestToJson(
  CreateMergeCaseRequest instance,
) => <String, dynamic>{
  'reason': instance.reason,
  'targetPatientId': instance.targetPatientId,
};
