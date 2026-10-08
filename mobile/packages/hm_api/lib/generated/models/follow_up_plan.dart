// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'follow_up_status.dart';

part 'follow_up_plan.g.dart';

@JsonSerializable()
class FollowUpPlan {
  const FollowUpPlan({
    required this.appointmentId,
    required this.createdAt,
    required this.createdByUserId,
    required this.doctorProfileId,
    required this.dueEndDate,
    required this.dueStartDate,
    required this.id,
    required this.instructions,
    required this.patientId,
    required this.reason,
    required this.rowVersion,
    required this.serialId,
    required this.sourceEncounterId,
    required this.status,
    required this.tenantId,
    required this.updatedAt,
    required this.updatedByUserId,
  });
  
  factory FollowUpPlan.fromJson(Map<String, Object?> json) => _$FollowUpPlanFromJson(json);
  
  final String? appointmentId;
  final DateTime createdAt;
  final String? createdByUserId;
  final String doctorProfileId;
  final String? dueEndDate;
  final String dueStartDate;
  final String id;
  final String? instructions;
  final String patientId;
  final String reason;
  final int rowVersion;
  final String? serialId;
  final String sourceEncounterId;
  final FollowUpStatus status;
  final String tenantId;
  final DateTime updatedAt;
  final String? updatedByUserId;

  Map<String, Object?> toJson() => _$FollowUpPlanToJson(this);
}
