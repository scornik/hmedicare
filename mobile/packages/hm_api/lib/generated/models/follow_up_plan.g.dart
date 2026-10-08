// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'follow_up_plan.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

FollowUpPlan _$FollowUpPlanFromJson(Map<String, dynamic> json) => FollowUpPlan(
  appointmentId: json['appointmentId'] as String?,
  createdAt: DateTime.parse(json['createdAt'] as String),
  createdByUserId: json['createdByUserId'] as String?,
  doctorProfileId: json['doctorProfileId'] as String,
  dueEndDate: json['dueEndDate'] as String?,
  dueStartDate: json['dueStartDate'] as String,
  id: json['id'] as String,
  instructions: json['instructions'] as String?,
  patientId: json['patientId'] as String,
  reason: json['reason'] as String,
  rowVersion: (json['rowVersion'] as num).toInt(),
  serialId: json['serialId'] as String?,
  sourceEncounterId: json['sourceEncounterId'] as String,
  status: FollowUpStatus.fromJson(json['status'] as String),
  tenantId: json['tenantId'] as String,
  updatedAt: DateTime.parse(json['updatedAt'] as String),
  updatedByUserId: json['updatedByUserId'] as String?,
);

Map<String, dynamic> _$FollowUpPlanToJson(FollowUpPlan instance) =>
    <String, dynamic>{
      'appointmentId': ?instance.appointmentId,
      'createdAt': instance.createdAt.toIso8601String(),
      'createdByUserId': ?instance.createdByUserId,
      'doctorProfileId': instance.doctorProfileId,
      'dueEndDate': ?instance.dueEndDate,
      'dueStartDate': instance.dueStartDate,
      'id': instance.id,
      'instructions': ?instance.instructions,
      'patientId': instance.patientId,
      'reason': instance.reason,
      'rowVersion': instance.rowVersion,
      'serialId': ?instance.serialId,
      'sourceEncounterId': instance.sourceEncounterId,
      'status': instance.status,
      'tenantId': instance.tenantId,
      'updatedAt': instance.updatedAt.toIso8601String(),
      'updatedByUserId': ?instance.updatedByUserId,
    };
