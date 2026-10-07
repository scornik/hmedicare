// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'prescription_clinical_status.dart';
import 'prescription_item.dart';
import 'prescription_render_status.dart';

part 'prescription.g.dart';

@JsonSerializable()
class Prescription {
  const Prescription({
    required this.approvedAt,
    required this.approvedByDoctorProfileId,
    required this.approvedSnapshotSha256,
    required this.attestationVersion,
    required this.clinicalStatus,
    required this.createdAt,
    required this.doctorProfileId,
    required this.encounterId,
    required this.id,
    required this.items,
    required this.patientId,
    required this.renderStatus,
    required this.renderedDocumentId,
    required this.reviewedAt,
    required this.reviewedByUserId,
    required this.revision,
    required this.rowVersion,
    required this.supersedesPrescriptionId,
    required this.voidReason,
    required this.voidedAt,
    required this.voidedByUserId,
  });
  
  factory Prescription.fromJson(Map<String, Object?> json) => _$PrescriptionFromJson(json);
  
  final DateTime? approvedAt;
  final String? approvedByDoctorProfileId;

  /// SHA-256 over the header and items at approval; what was approved, provably
  final String? approvedSnapshotSha256;
  final int? attestationVersion;
  final PrescriptionClinicalStatus clinicalStatus;
  final DateTime createdAt;
  final String doctorProfileId;
  final String encounterId;
  final String id;
  final List<PrescriptionItem> items;
  final String patientId;
  final PrescriptionRenderStatus renderStatus;

  /// The stored PDF, once a render has produced one; null until then
  final String? renderedDocumentId;
  final DateTime? reviewedAt;
  final String? reviewedByUserId;

  /// 1, 2, … per encounter; a correction is a new one
  final int revision;
  final int rowVersion;
  final String? supersedesPrescriptionId;
  final String? voidReason;
  final DateTime? voidedAt;
  final String? voidedByUserId;

  Map<String, Object?> toJson() => _$PrescriptionToJson(this);
}
