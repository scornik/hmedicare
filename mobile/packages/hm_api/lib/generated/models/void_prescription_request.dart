// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'void_prescription_request.g.dart';

@JsonSerializable()
class VoidPrescriptionRequest {
  const VoidPrescriptionRequest({
    required this.expectedRowVersion,
    required this.reason,
    this.clinicalReviewerDoctorProfileId,
  });
  
  factory VoidPrescriptionRequest.fromJson(Map<String, Object?> json) => _$VoidPrescriptionRequestFromJson(json);
  
  /// Required when a clinic admin voids (AUTHORIZATION-MATRIX §6)
  final String? clinicalReviewerDoctorProfileId;
  final int expectedRowVersion;
  final String reason;

  Map<String, Object?> toJson() => _$VoidPrescriptionRequestToJson(this);
}
