// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_approval_approved_target.dart';

part 'ai_approval.g.dart';

@JsonSerializable()
class AiApproval {
  const AiApproval({
    required this.aiSuggestionId,
    required this.approvedAt,
    required this.approvedRecordId,
    required this.approvedRecordType,
    required this.approvedSection,
    required this.approvedTarget,
    required this.attestationVersion,
    required this.id,
  });
  
  factory AiApproval.fromJson(Map<String, Object?> json) => _$AiApprovalFromJson(json);
  
  final String aiSuggestionId;
  final DateTime approvedAt;
  final String approvedRecordId;
  final String approvedRecordType;
  final String? approvedSection;
  final AiApprovalApprovedTarget approvedTarget;
  final int attestationVersion;
  final String id;

  Map<String, Object?> toJson() => _$AiApprovalToJson(this);
}
