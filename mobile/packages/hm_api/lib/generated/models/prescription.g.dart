// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'prescription.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Prescription _$PrescriptionFromJson(Map<String, dynamic> json) => Prescription(
  approvedAt: json['approvedAt'] == null
      ? null
      : DateTime.parse(json['approvedAt'] as String),
  approvedByDoctorProfileId: json['approvedByDoctorProfileId'] as String?,
  approvedSnapshotSha256: json['approvedSnapshotSha256'] as String?,
  attestationVersion: (json['attestationVersion'] as num?)?.toInt(),
  clinicalStatus: PrescriptionClinicalStatus.fromJson(
    json['clinicalStatus'] as String,
  ),
  createdAt: DateTime.parse(json['createdAt'] as String),
  doctorProfileId: json['doctorProfileId'] as String,
  encounterId: json['encounterId'] as String,
  id: json['id'] as String,
  items: (json['items'] as List<dynamic>)
      .map((e) => PrescriptionItem.fromJson(e as Map<String, dynamic>))
      .toList(),
  patientId: json['patientId'] as String,
  renderStatus: PrescriptionRenderStatus.fromJson(
    json['renderStatus'] as String,
  ),
  renderedDocumentId: json['renderedDocumentId'] as String?,
  reviewedAt: json['reviewedAt'] == null
      ? null
      : DateTime.parse(json['reviewedAt'] as String),
  reviewedByUserId: json['reviewedByUserId'] as String?,
  revision: (json['revision'] as num).toInt(),
  rowVersion: (json['rowVersion'] as num).toInt(),
  supersedesPrescriptionId: json['supersedesPrescriptionId'] as String?,
  voidReason: json['voidReason'] as String?,
  voidedAt: json['voidedAt'] == null
      ? null
      : DateTime.parse(json['voidedAt'] as String),
  voidedByUserId: json['voidedByUserId'] as String?,
);

Map<String, dynamic> _$PrescriptionToJson(Prescription instance) =>
    <String, dynamic>{
      'approvedAt': ?instance.approvedAt?.toIso8601String(),
      'approvedByDoctorProfileId': ?instance.approvedByDoctorProfileId,
      'approvedSnapshotSha256': ?instance.approvedSnapshotSha256,
      'attestationVersion': ?instance.attestationVersion,
      'clinicalStatus': instance.clinicalStatus,
      'createdAt': instance.createdAt.toIso8601String(),
      'doctorProfileId': instance.doctorProfileId,
      'encounterId': instance.encounterId,
      'id': instance.id,
      'items': instance.items,
      'patientId': instance.patientId,
      'renderStatus': instance.renderStatus,
      'renderedDocumentId': ?instance.renderedDocumentId,
      'reviewedAt': ?instance.reviewedAt?.toIso8601String(),
      'reviewedByUserId': ?instance.reviewedByUserId,
      'revision': instance.revision,
      'rowVersion': instance.rowVersion,
      'supersedesPrescriptionId': ?instance.supersedesPrescriptionId,
      'voidReason': ?instance.voidReason,
      'voidedAt': ?instance.voidedAt?.toIso8601String(),
      'voidedByUserId': ?instance.voidedByUserId,
    };
