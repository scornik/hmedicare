// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'ai_job.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AiJob _$AiJobFromJson(Map<String, dynamic> json) => AiJob(
  cancelRequestedAt: json['cancelRequestedAt'] == null
      ? null
      : DateTime.parse(json['cancelRequestedAt'] as String),
  declaredTier: AiJobDeclaredTier.fromJson(json['declaredTier'] as String),
  draftId: json['draftId'] as String?,
  effectiveDataUsePolicy: AiJobEffectiveDataUsePolicy.fromJson(
    json['effectiveDataUsePolicy'] as String,
  ),
  encounterId: json['encounterId'] as String,
  errorClass: json['errorClass'] as String?,
  errorReason: json['errorReason'] as String?,
  finishedAt: json['finishedAt'] == null
      ? null
      : DateTime.parse(json['finishedAt'] as String),
  id: json['id'] as String,
  modelId: json['modelId'] as String,
  promptTemplateVersion: json['promptTemplateVersion'] as String,
  providerCode: json['providerCode'] as String,
  purpose: AiJobPurpose.fromJson(json['purpose'] as String),
  rowVersion: (json['rowVersion'] as num).toInt(),
  startedAt: json['startedAt'] == null
      ? null
      : DateTime.parse(json['startedAt'] as String),
  status: AiJobStatus.fromJson(json['status'] as String),
);

Map<String, dynamic> _$AiJobToJson(AiJob instance) => <String, dynamic>{
  'cancelRequestedAt': ?instance.cancelRequestedAt?.toIso8601String(),
  'declaredTier': instance.declaredTier,
  'draftId': ?instance.draftId,
  'effectiveDataUsePolicy': instance.effectiveDataUsePolicy,
  'encounterId': instance.encounterId,
  'errorClass': ?instance.errorClass,
  'errorReason': ?instance.errorReason,
  'finishedAt': ?instance.finishedAt?.toIso8601String(),
  'id': instance.id,
  'modelId': instance.modelId,
  'promptTemplateVersion': instance.promptTemplateVersion,
  'providerCode': instance.providerCode,
  'purpose': instance.purpose,
  'rowVersion': instance.rowVersion,
  'startedAt': ?instance.startedAt?.toIso8601String(),
  'status': instance.status,
};
