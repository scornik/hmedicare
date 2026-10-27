// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'lab_report_view_review_status.dart';

part 'lab_report_view.g.dart';

@JsonSerializable()
class LabReportView {
  const LabReportView({
    required this.documentId,
    required this.encounterId,
    required this.id,
    required this.labName,
    required this.patientId,
    required this.patientShared,
    required this.reportDate,
    required this.reviewStatus,
    required this.reviewedAt,
    required this.rowVersion,
  });
  
  factory LabReportView.fromJson(Map<String, Object?> json) => _$LabReportViewFromJson(json);
  
  final String documentId;
  final String? encounterId;
  final String id;
  final String? labName;
  final String patientId;
  final bool patientShared;
  final String? reportDate;
  final LabReportViewReviewStatus reviewStatus;
  final DateTime? reviewedAt;
  final int rowVersion;

  Map<String, Object?> toJson() => _$LabReportViewToJson(this);
}
