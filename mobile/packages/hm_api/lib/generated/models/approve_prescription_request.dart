// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'approve_prescription_request.g.dart';

@JsonSerializable()
class ApprovePrescriptionRequest {
  const ApprovePrescriptionRequest({
    required this.attestationVersion,
    required this.expectedRowVersion,
  });
  
  factory ApprovePrescriptionRequest.fromJson(Map<String, Object?> json) => _$ApprovePrescriptionRequestFromJson(json);
  
  /// The attestation text the doctor read; a mismatch means reload and read it again
  final int attestationVersion;
  final int expectedRowVersion;

  Map<String, Object?> toJson() => _$ApprovePrescriptionRequestToJson(this);
}
