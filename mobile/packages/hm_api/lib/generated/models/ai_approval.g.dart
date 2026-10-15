// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'ai_approval.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AiApproval _$AiApprovalFromJson(Map<String, dynamic> json) => AiApproval(
  aiSuggestionId: json['aiSuggestionId'] as String,
  approvedAt: DateTime.parse(json['approvedAt'] as String),
  approvedRecordId: json['approvedRecordId'] as String,
  approvedRecordType: json['approvedRecordType'] as String,
  approvedSection: json['approvedSection'] as String?,
  approvedTarget: AiApprovalApprovedTarget.fromJson(
    json['approvedTarget'] as String,
  ),
  attestationVersion: (json['attestationVersion'] as num).toInt(),
  id: json['id'] as String,
);

Map<String, dynamic> _$AiApprovalToJson(AiApproval instance) =>
    <String, dynamic>{
      'aiSuggestionId': instance.aiSuggestionId,
      'approvedAt': instance.approvedAt.toIso8601String(),
      'approvedRecordId': instance.approvedRecordId,
      'approvedRecordType': instance.approvedRecordType,
      'approvedSection': ?instance.approvedSection,
      'approvedTarget': instance.approvedTarget,
      'attestationVersion': instance.attestationVersion,
      'id': instance.id,
    };
