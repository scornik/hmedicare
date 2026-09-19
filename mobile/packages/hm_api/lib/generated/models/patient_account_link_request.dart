// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'patient_account_link_request.g.dart';

@JsonSerializable()
class PatientAccountLinkRequest {
  const PatientAccountLinkRequest({
    required this.patientId,
    required this.tenantId,
  });
  
  factory PatientAccountLinkRequest.fromJson(Map<String, Object?> json) => _$PatientAccountLinkRequestFromJson(json);
  
  final String patientId;
  final String tenantId;

  Map<String, Object?> toJson() => _$PatientAccountLinkRequestToJson(this);
}
