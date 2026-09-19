// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'merge_case.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MergeCase _$MergeCaseFromJson(Map<String, dynamic> json) => MergeCase(
  createdAt: DateTime.parse(json['createdAt'] as String),
  duplicateScore: json['duplicateScore'] as num?,
  id: json['id'] as String,
  reason: json['reason'] as String,
  requestedByUserId: json['requestedByUserId'] as String,
  reviewedAt: json['reviewedAt'] == null
      ? null
      : DateTime.parse(json['reviewedAt'] as String),
  reviewedByUserId: json['reviewedByUserId'] as String?,
  rowVersion: (json['rowVersion'] as num).toInt(),
  sourcePatientId: json['sourcePatientId'] as String,
  status: MergeCaseStatus.fromJson(json['status'] as String),
  targetPatientId: json['targetPatientId'] as String,
);

Map<String, dynamic> _$MergeCaseToJson(MergeCase instance) => <String, dynamic>{
  'createdAt': instance.createdAt.toIso8601String(),
  'duplicateScore': ?instance.duplicateScore,
  'id': instance.id,
  'reason': instance.reason,
  'requestedByUserId': instance.requestedByUserId,
  'reviewedAt': ?instance.reviewedAt?.toIso8601String(),
  'reviewedByUserId': ?instance.reviewedByUserId,
  'rowVersion': instance.rowVersion,
  'sourcePatientId': instance.sourcePatientId,
  'status': instance.status,
  'targetPatientId': instance.targetPatientId,
};
