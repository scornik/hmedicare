// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'void_diagnosis_request.g.dart';

@JsonSerializable()
class VoidDiagnosisRequest {
  const VoidDiagnosisRequest({
    required this.expectedRowVersion,
    required this.reason,
  });
  
  factory VoidDiagnosisRequest.fromJson(Map<String, Object?> json) => _$VoidDiagnosisRequestFromJson(json);
  
  final int expectedRowVersion;
  final String reason;

  Map<String, Object?> toJson() => _$VoidDiagnosisRequestToJson(this);
}
