// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'patient_context.g.dart';

@JsonSerializable()
class PatientContext {
  const PatientContext({
    required this.authorityScope,
    required this.patientDisplayName,
    required this.patientId,
    required this.relationship,
    required this.tenantId,
    required this.tenantName,
  });
  
  factory PatientContext.fromJson(Map<String, Object?> json) => _$PatientContextFromJson(json);
  
  final List<String> authorityScope;
  final String patientDisplayName;
  final String patientId;
  final String relationship;
  final String tenantId;
  final String tenantName;

  Map<String, Object?> toJson() => _$PatientContextToJson(this);
}
