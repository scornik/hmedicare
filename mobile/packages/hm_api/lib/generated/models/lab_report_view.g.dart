// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'lab_report_view.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

LabReportView _$LabReportViewFromJson(Map<String, dynamic> json) =>
    LabReportView(
      documentId: json['documentId'] as String,
      encounterId: json['encounterId'] as String?,
      id: json['id'] as String,
      labName: json['labName'] as String?,
      patientId: json['patientId'] as String,
      patientShared: json['patientShared'] as bool,
      reportDate: json['reportDate'] as String?,
      reviewStatus: LabReportViewReviewStatus.fromJson(
        json['reviewStatus'] as String,
      ),
      reviewedAt: json['reviewedAt'] == null
          ? null
          : DateTime.parse(json['reviewedAt'] as String),
      rowVersion: (json['rowVersion'] as num).toInt(),
    );

Map<String, dynamic> _$LabReportViewToJson(LabReportView instance) =>
    <String, dynamic>{
      'documentId': instance.documentId,
      'encounterId': ?instance.encounterId,
      'id': instance.id,
      'labName': ?instance.labName,
      'patientId': instance.patientId,
      'patientShared': instance.patientShared,
      'reportDate': ?instance.reportDate,
      'reviewStatus': instance.reviewStatus,
      'reviewedAt': ?instance.reviewedAt?.toIso8601String(),
      'rowVersion': instance.rowVersion,
    };
