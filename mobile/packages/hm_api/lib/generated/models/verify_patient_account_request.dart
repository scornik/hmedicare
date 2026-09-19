// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'verify_patient_account_request_method.dart';

part 'verify_patient_account_request.g.dart';

@JsonSerializable()
class VerifyPatientAccountRequest {
  const VerifyPatientAccountRequest({
    required this.expectedRowVersion,
    required this.method,
  });
  
  factory VerifyPatientAccountRequest.fromJson(Map<String, Object?> json) => _$VerifyPatientAccountRequestFromJson(json);
  
  final int expectedRowVersion;
  final VerifyPatientAccountRequestMethod method;

  Map<String, Object?> toJson() => _$VerifyPatientAccountRequestToJson(this);
}
