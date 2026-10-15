// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_job_declared_tier.dart';
import 'ai_job_effective_data_use_policy.dart';
import 'ai_job_purpose.dart';
import 'ai_job_status.dart';

part 'ai_job.g.dart';

@JsonSerializable()
class AiJob {
  const AiJob({
    required this.cancelRequestedAt,
    required this.declaredTier,
    required this.draftId,
    required this.effectiveDataUsePolicy,
    required this.encounterId,
    required this.errorClass,
    required this.errorReason,
    required this.finishedAt,
    required this.id,
    required this.modelId,
    required this.promptTemplateVersion,
    required this.providerCode,
    required this.purpose,
    required this.rowVersion,
    required this.startedAt,
    required this.status,
  });
  
  factory AiJob.fromJson(Map<String, Object?> json) => _$AiJobFromJson(json);
  
  final DateTime? cancelRequestedAt;
  final AiJobDeclaredTier declaredTier;

  /// Authorized draft reference when available; null until a draft is persisted
  final String? draftId;

  /// Shown beside every suggestion this job produced
  final AiJobEffectiveDataUsePolicy effectiveDataUsePolicy;
  final String encounterId;
  final String? errorClass;

  /// A rule or category name, never a provider message
  final String? errorReason;
  final DateTime? finishedAt;
  final String id;
  final String modelId;
  final String promptTemplateVersion;
  final String providerCode;
  final AiJobPurpose purpose;
  final int rowVersion;
  final DateTime? startedAt;
  final AiJobStatus status;

  Map<String, Object?> toJson() => _$AiJobToJson(this);
}
