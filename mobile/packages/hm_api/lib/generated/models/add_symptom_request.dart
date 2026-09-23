// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'add_symptom_request_certainty.dart';
import 'add_symptom_request_severity.dart';
import 'add_symptom_request_source.dart';

part 'add_symptom_request.g.dart';

@JsonSerializable()
class AddSymptomRequest {
  const AddSymptomRequest({
    required this.certainty,
    required this.display,
    required this.source,
    this.codeSystem,
    this.detail,
    this.normalizedCode,
    this.onset,
    this.severity,
  });
  
  factory AddSymptomRequest.fromJson(Map<String, Object?> json) => _$AddSymptomRequestFromJson(json);
  
  final AddSymptomRequestCertainty certainty;
  final String? codeSystem;
  final String? detail;
  final String display;
  final String? normalizedCode;
  final String? onset;
  final AddSymptomRequestSeverity? severity;

  /// Who it came from. `AI_APPROVED` exists in the model and no route can set it
  final AddSymptomRequestSource source;

  Map<String, Object?> toJson() => _$AddSymptomRequestToJson(this);
}
